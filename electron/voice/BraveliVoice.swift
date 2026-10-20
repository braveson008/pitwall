// Braveli's ears and mouth.
//
// A small stdio daemon: newline-delimited JSON commands on stdin, newline-
// delimited JSON events on stdout. It owns the microphone, the speech
// recogniser and the speech synthesiser, and it owns nothing else — all
// decisions about what an utterance *means* happen in the Electron main
// process, which is what keeps voice a transport rather than a second brain.
//
// ## Why a separate process
//
// Chromium's renderer can reach `getUserMedia`, but not Apple's on-device
// speech stack, and an always-on recogniser inside the renderer would die with
// every reload. A sidecar also means a crash here degrades Braveli to a normal
// GUI app instead of taking the window down with it.
//
// ## Speech recognition backend
//
// This uses `SFSpeechRecognizer` with `requiresOnDeviceRecognition = true`:
// fully offline, no network, no API key. macOS 26 ships the newer
// `SpeechAnalyzer`/`SpeechTranscriber` API which is faster and has no task
// duration limit — the recogniser here is deliberately isolated behind
// `startRecognition`/`stopRecognition` so that backend can be swapped in
// without touching the audio graph, the wake-word logic or the protocol.
//
// On-device `SFSpeechRecognizer` tasks stop on their own after roughly a
// minute, which for an always-listening assistant is not an edge case but the
// normal path, so restart is handled as routine rather than as error recovery.
//
// ## Half duplex
//
// While Braveli is speaking, incoming audio is discarded rather than
// transcribed. Without that the assistant transcribes its own voice and
// answers itself. Barge-in is preserved by still measuring input energy during
// playback: sustained speech-level input stops the utterance and hands the
// microphone back.

import AVFoundation
import Foundation
import Speech

// MARK: - Protocol

/// Events are written as one JSON object per line. Anything that is not a
/// complete line is not a message, which makes the stream trivially resyncable
/// if a write is ever interrupted.
final class EventWriter {
    private let queue = DispatchQueue(label: "app.braveli.voice.out")

    func emit(_ type: String, _ payload: [String: Any] = [:]) {
        var object = payload
        object["type"] = type
        queue.async {
            guard
                let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]),
                var line = String(data: data, encoding: .utf8)
            else { return }
            line += "\n"
            FileHandle.standardOutput.write(Data(line.utf8))
        }
    }

    func fail(_ message: String, fatal: Bool = false) {
        emit("error", ["message": message, "fatal": fatal])
    }
}

let events = EventWriter()

// MARK: - Configuration

struct Config {
    /// Matched against the transcript to open the microphone. Kept as a list so
    /// homophones the recogniser reliably produces ("bravely", "bravelli") are
    /// treated as the wake word rather than as failures the user has to work
    /// around by changing how they speak.
    var wakeWords: [String] = ["braveli", "bravely", "bravelli", "brave lee", "brave li"]
    /// How long the user must actually stop speaking before the command is
    /// treated as finished and run.
    ///
    /// This is measured against microphone energy, not just against the
    /// transcript going quiet. On-device recognition emits partial results in
    /// bursts, so "the transcript stopped changing" happens *while* someone is
    /// still mid-sentence — endpointing on that alone cuts people off.
    var silenceTimeout: TimeInterval = 3.0
    /// Input RMS above which someone is considered to be talking. Above room
    /// tone and fan noise, below normal speech.
    var speechThreshold: Float = 0.018
    /// Ceiling on a single command, so a stuck recogniser cannot listen forever.
    var maxCommandDuration: TimeInterval = 25.0
    /// How long to keep listening after Braveli finishes speaking, so a reply
    /// can be answered without saying the wake word again.
    ///
    /// Requiring the wake word on every turn is correct for the first request
    /// and wrong for the second: a conversation is a conversation. The window
    /// is bounded rather than open-ended because an always-open microphone
    /// would transcribe the room, and it closes silently if nobody speaks.
    var followUpWindow: TimeInterval = 8.0
    var locale: String = "en-US"
    var voiceIdentifier: String?
    /// Delivery. AVSpeechUtterance's default rate (0.5) is tuned for
    /// screen-reader efficiency; anything meant to be pleasant company runs
    /// slower than that, with the pitch nudged down slightly.
    var speechRate: Float = 0.46
    var pitch: Float = 0.96
    var volume: Float = 0.95
    var bargeInEnabled: Bool = true
    /// Input RMS that counts as someone talking over the assistant. Set above
    /// room tone and typical speaker bleed.
    var bargeInThreshold: Float = 0.045
    var bargeInSustainedFrames: Int = 6
}

// MARK: - Voice daemon

final class VoiceDaemon: NSObject, AVSpeechSynthesizerDelegate {
    private let engine = AVAudioEngine()
    private let synthesizer = AVSpeechSynthesizer()
    private let state = DispatchQueue(label: "app.braveli.voice.state")

    private var recognizer: SFSpeechRecognizer?
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?

    private var config = Config()

    /// `idle` is not listening at all; `wake` is listening for the wake word;
    /// `command` is capturing an utterance to send upstream. Push-to-talk
    /// enters `command` directly, which is why the two are separate states
    /// rather than a single boolean.
    private enum Mode: String { case idle, wake, command }
    private var mode: Mode = .idle

    private var isSpeaking = false
    private var currentUtteranceId: String?
    private var transcriptAtWake = ""
    private var lastTranscript = ""
    private var silenceTimer: DispatchSourceTimer?
    private var commandDeadline: DispatchSourceTimer?
    private var restartWorkItem: DispatchWorkItem?
    private var loudFrames = 0
    private var levelCounter = 0
    private var tapInstalled = false
    /// When the microphone last heard speech-level input. The endpoint timer is
    /// measured from here, so a thinking pause mid-sentence does not fire it
    /// but genuinely stopping does.
    private var lastVoiceAt = CFAbsoluteTimeGetCurrent()
    /// When the recogniser last revised the command text. Recognition lags the
    /// audio, so this is checked alongside microphone energy.
    private var lastTranscriptChangeAt = CFAbsoluteTimeGetCurrent()
    private var settlingAnnounced = false
    /// Whether anyone has actually spoken since this capture opened.
    ///
    /// The endpoint timer must not be allowed to end a turn that never began.
    /// A wake-word capture starts true — the wake word is speech — but a
    /// follow-up window or a push-to-talk capture starts false, so a pause
    /// before the first word is a pause, not a cancelled request.
    private var heardSpeechThisTurn = false
    private var followUpTimer: DispatchSourceTimer?
    /// Set when a turn produced a real request, so the reply to it can be
    /// followed by more conversation.
    private var expectFollowUp = false
    private var recognitionGeneration = 0
    private var lastTaskStartedAt: CFAbsoluteTime = 0
    private var watchdog: DispatchSourceTimer?

    override init() {
        super.init()
        synthesizer.delegate = self
    }

    // MARK: Permissions

    func requestPermissions(then continuation: @escaping (Bool) -> Void) {
        AVCaptureDevice.requestAccess(for: .audio) { micGranted in
            SFSpeechRecognizer.requestAuthorization { speechStatus in
                let speechGranted = speechStatus == .authorized
                events.emit("permission", [
                    "microphone": micGranted ? "granted" : "denied",
                    "speech": String(describing: speechStatus).replacingOccurrences(of: "SFSpeechRecognizerAuthorizationStatus", with: ""),
                    "ok": micGranted && speechGranted,
                ])
                continuation(micGranted && speechGranted)
            }
        }
    }

    // MARK: Audio graph

    /// The tap is installed once and left in place. Tearing the audio graph
    /// down between utterances adds a noticeable delay before the microphone is
    /// live again, and on macOS repeatedly starting the engine is a reliable
    /// way to end up with a device that never produces buffers again.
    private func ensureEngineRunning() throws {
        guard !tapInstalled else {
            if !engine.isRunning { try engine.start() }
            return
        }

        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0 else {
            throw NSError(domain: "app.braveli.voice", code: 1,
                          userInfo: [NSLocalizedDescriptionKey: "No usable audio input device."])
        }

        input.installTap(onBus: 0, bufferSize: 2048, format: format) { [weak self] buffer, _ in
            self?.handle(buffer: buffer)
        }
        tapInstalled = true
        engine.prepare()
        try engine.start()
    }

    private func handle(buffer: AVAudioPCMBuffer) {
        let level = Self.rms(of: buffer)

        state.async { [weak self] in
            guard let self else { return }

            // Report the level even while muted: the HUD meter reacting to the
            // user's own voice is how they discover barge-in exists.
            self.levelCounter += 1
            if self.levelCounter % 4 == 0 {
                events.emit("level", ["rms": Double(level), "speaking": self.isSpeaking])
            }

            if self.isSpeaking {
                self.considerBargeIn(level: level)
                return  // Half duplex: never transcribe our own output.
            }

            // Voice activity is what the endpoint timer measures against.
            if level >= self.config.speechThreshold {
                self.lastVoiceAt = CFAbsoluteTimeGetCurrent()
                if self.mode == .command && !self.heardSpeechThisTurn {
                    // The turn has genuinely started, so the endpoint timer and
                    // the transcript stability check now mean something.
                    self.heardSpeechThisTurn = true
                    self.lastTranscriptChangeAt = self.lastVoiceAt
                    self.cancelFollowUpTimer()
                }
                if self.settlingAnnounced {
                    // They started talking again during the countdown.
                    self.settlingAnnounced = false
                    events.emit("resumed")
                }
            }

            self.request?.append(buffer)
        }
    }

    private func considerBargeIn(level: Float) {
        guard config.bargeInEnabled else { return }
        if level >= config.bargeInThreshold {
            loudFrames += 1
            if loudFrames >= config.bargeInSustainedFrames {
                loudFrames = 0
                events.emit("barge_in")
                stopSpeaking()
            }
        } else {
            loudFrames = 0
        }
    }

    private static func rms(of buffer: AVAudioPCMBuffer) -> Float {
        guard let channel = buffer.floatChannelData?[0] else { return 0 }
        let count = Int(buffer.frameLength)
        guard count > 0 else { return 0 }
        var sum: Float = 0
        for index in 0..<count {
            let sample = channel[index]
            sum += sample * sample
        }
        return (sum / Float(count)).squareRoot()
    }

    // MARK: Recognition

    private func startRecognition() {
        stopRecognition()

        // Every task gets a generation. Cancelling an SFSpeechRecognitionTask
        // invokes its own completion handler with an error, so without this a
        // restart cancels the previous task, whose callback schedules another
        // restart, which cancels the task that was just created — the
        // recogniser oscillates and never settles. The visible symptom is that
        // the first spoken command works and nothing afterwards is ever heard.
        recognitionGeneration += 1
        let generation = recognitionGeneration

        let locale = Locale(identifier: config.locale)
        guard let recognizer = SFSpeechRecognizer(locale: locale), recognizer.isAvailable else {
            events.fail("Speech recognition is unavailable for locale \(config.locale).", fatal: true)
            return
        }
        self.recognizer = recognizer

        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        // Everything stays on the machine. This is also what makes an
        // always-listening assistant defensible at all.
        if recognizer.supportsOnDeviceRecognition {
            request.requiresOnDeviceRecognition = true
        } else {
            events.emit("warning", ["message": "On-device recognition unavailable; audio would leave the device. Recognition disabled."])
            return
        }
        self.request = request

        transcriptAtWake = ""
        lastTranscript = ""

        task = recognizer.recognitionTask(with: request) { [weak self] result, error in
            guard let self else { return }
            self.state.async {
                // A callback from a task we already replaced says nothing about
                // the live one. Ignoring it is what breaks the restart loop.
                guard generation == self.recognitionGeneration else { return }

                if let result { self.consume(transcript: result.bestTranscription.formattedString) }

                if error != nil || (result?.isFinal ?? false) {
                    // An on-device task ending is expected, not exceptional: it
                    // hits its duration limit every minute or so.
                    self.task = nil
                    self.scheduleRestartIfListening()
                }
            }
        }

        lastTaskStartedAt = CFAbsoluteTimeGetCurrent()
        events.emit("state", ["mode": mode.rawValue, "listening": true])
    }

    private func stopRecognition() {
        // Invalidate any callback still in flight before tearing the task down.
        recognitionGeneration += 1
        restartWorkItem?.cancel()
        restartWorkItem = nil
        task?.cancel()
        task = nil
        request?.endAudio()
        request = nil
    }

    /// Safety net for an always-listening assistant: if the recogniser has been
    /// absent while we are supposed to be listening, bring it back. Without
    /// this, any unforeseen path that loses the task leaves Braveli looking
    /// awake — the HUD still says "listening" — while hearing nothing at all.
    private func startWatchdog() {
        watchdog?.cancel()
        let timer = DispatchSource.makeTimerSource(queue: state)
        timer.schedule(deadline: .now() + 2, repeating: 2)
        timer.setEventHandler { [weak self] in
            guard let self, self.mode != .idle, !self.isSpeaking else { return }
            let stalled = self.task == nil && CFAbsoluteTimeGetCurrent() - self.lastTaskStartedAt > 2
            if stalled {
                events.emit("recovered", ["reason": "recognizer stalled"])
                self.startRecognition()
            }
        }
        timer.resume()
        watchdog = timer
    }

    private func scheduleRestartIfListening() {
        guard mode != .idle else { return }
        restartWorkItem?.cancel()
        let work = DispatchWorkItem { [weak self] in
            guard let self else { return }
            self.state.async {
                guard self.mode != .idle else { return }
                self.startRecognition()
            }
        }
        restartWorkItem = work
        // A short gap lets the previous task release the recogniser; restarting
        // immediately intermittently yields a task that never emits.
        state.asyncAfter(deadline: .now() + 0.25, execute: work)
    }

    /// Called on every partial result. Decides whether the wake word has been
    /// heard, and when an utterance has finished.
    private func consume(transcript: String) {
        guard mode != .idle else { return }

        if mode == .wake {
            let haystack = transcript.lowercased()
            guard let range = config.wakeWords.compactMap({ haystack.range(of: $0, options: .backwards) }).max(by: { $0.lowerBound < $1.lowerBound }) else {
                lastTranscript = transcript
                return
            }
            // Everything after the wake word is already part of the command —
            // people say "Braveli run the tests" in one breath far more often
            // than they pause and wait.
            let remainder = String(transcript[range.upperBound...])
            mode = .command
            transcriptAtWake = String(transcript[..<range.lowerBound])
            lastTranscript = transcript
            // The wake word itself counts as speech, so the endpoint window
            // starts from here rather than from whenever the app launched.
            lastVoiceAt = CFAbsoluteTimeGetCurrent()
            lastTranscriptChangeAt = lastVoiceAt
            settlingAnnounced = false
            heardSpeechThisTurn = true
            cancelFollowUpTimer()
            events.emit("wake", ["tail": remainder.trimmingCharacters(in: .whitespacesAndNewlines)])
            events.emit("state", ["mode": mode.rawValue, "listening": true])
            armCommandTimers()
            if !remainder.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                events.emit("partial", ["text": remainder.trimmingCharacters(in: .whitespacesAndNewlines)])
            }
            return
        }

        // mode == .command
        let command = commandText(from: transcript)
        if command != commandText(from: lastTranscript) {
            events.emit("partial", ["text": command])
            // Still being revised, so the utterance is not over yet.
            lastTranscriptChangeAt = CFAbsoluteTimeGetCurrent()
            if settlingAnnounced {
                settlingAnnounced = false
                events.emit("resumed")
            }
        }
        lastTranscript = transcript
    }

    private func commandText(from transcript: String) -> String {
        var text = transcript
        if !transcriptAtWake.isEmpty, text.hasPrefix(transcriptAtWake) {
            text = String(text.dropFirst(transcriptAtWake.count))
        }
        for wakeWord in config.wakeWords {
            if let range = text.lowercased().range(of: wakeWord) {
                text = String(text[range.upperBound...])
                break
            }
        }
        return text.trimmingCharacters(in: .whitespacesAndNewlines.union(CharacterSet(charactersIn: ",.!?")))
    }

    private func armCommandTimers() {
        silenceTimer?.cancel()
        let timer = DispatchSource.makeTimerSource(queue: state)
        // Checked on a short cadence rather than fired once: the decision
        // depends on microphone energy, which keeps changing after the timer
        // was scheduled.
        timer.schedule(deadline: .now() + 0.25, repeating: 0.25)
        timer.setEventHandler { [weak self] in self?.checkEndpoint() }
        timer.resume()
        silenceTimer = timer

        guard commandDeadline == nil else { return }
        let deadline = DispatchSource.makeTimerSource(queue: state)
        deadline.schedule(deadline: .now() + config.maxCommandDuration)
        deadline.setEventHandler { [weak self] in self?.finishCommand(reason: "timeout") }
        deadline.resume()
        commandDeadline = deadline
    }

    /// Has the user actually stopped talking?
    ///
    /// Both conditions must hold for the full window: the microphone is quiet,
    /// *and* the recogniser has stopped revising the transcript. Requiring both
    /// is what stops a trailing word being dropped when recognition lags behind
    /// the audio, which it routinely does by several hundred milliseconds.
    private func checkEndpoint() {
        guard mode == .command else { return }
        // Nothing has been said yet, so there is nothing to end. Without this
        // a capture opened by push-to-talk or by a follow-up window cancels
        // itself before the user has drawn breath.
        guard heardSpeechThisTurn else { return }
        let now = CFAbsoluteTimeGetCurrent()
        let quietFor = now - lastVoiceAt
        let stableFor = now - lastTranscriptChangeAt

        if quietFor >= config.silenceTimeout && stableFor >= config.silenceTimeout {
            finishCommand(reason: "silence")
            return
        }

        // Tell the UI a countdown is running, once, so "it's about to act" is
        // visible rather than a surprise.
        let remaining = config.silenceTimeout - min(quietFor, stableFor)
        if !settlingAnnounced && quietFor >= 0.6 && stableFor >= 0.6 {
            settlingAnnounced = true
            events.emit("settling", ["in": remaining])
        }
    }

    private func clearCommandTimers() {
        silenceTimer?.cancel()
        silenceTimer = nil
        commandDeadline?.cancel()
        commandDeadline = nil
        settlingAnnounced = false
        cancelFollowUpTimer()
    }

    private func cancelFollowUpTimer() {
        followUpTimer?.cancel()
        followUpTimer = nil
    }

    /// Reopen the microphone after Braveli has finished answering, so the next
    /// thing the user says is treated as the next turn rather than ignored for
    /// missing a wake word.
    private func openFollowUpWindow() {
        guard mode == .wake, config.followUpWindow > 0 else { return }
        mode = .command
        transcriptAtWake = ""
        lastTranscript = ""
        heardSpeechThisTurn = false
        settlingAnnounced = false
        lastVoiceAt = CFAbsoluteTimeGetCurrent()
        lastTranscriptChangeAt = lastVoiceAt

        // The HUD reads this the same way it reads a wake word, because from
        // the user's side it is the same state: Braveli is listening to them.
        events.emit("wake", ["tail": "", "followUp": true])
        events.emit("state", ["mode": mode.rawValue, "listening": true])
        armCommandTimers()

        cancelFollowUpTimer()
        let timer = DispatchSource.makeTimerSource(queue: state)
        timer.schedule(deadline: .now() + config.followUpWindow)
        timer.setEventHandler { [weak self] in
            guard let self else { return }
            // Someone started talking, so the endpoint timer owns the turn now.
            guard self.mode == .command, !self.heardSpeechThisTurn else { return }
            self.cancelFollowUpTimer()
            self.clearCommandTimers()
            self.mode = .wake
            self.expectFollowUp = false
            events.emit("follow_up_expired")
            events.emit("state", ["mode": self.mode.rawValue, "listening": true])
            self.startRecognition()
        }
        timer.resume()
        followUpTimer = timer
    }

    private func finishCommand(reason: String) {
        guard mode == .command else { return }
        clearCommandTimers()
        let text = commandText(from: lastTranscript)
        mode = .wake
        transcriptAtWake = ""
        lastTranscript = ""

        if text.isEmpty {
            expectFollowUp = false
            events.emit("cancelled", ["reason": reason])
        } else {
            // A real request was made, so whatever Braveli says back is part of
            // a conversation and deserves a chance to be answered.
            expectFollowUp = true
            events.emit("transcript", ["text": text, "final": true, "reason": reason])
        }
        events.emit("state", ["mode": mode.rawValue, "listening": true])
        // Start a clean recognition task so the finished utterance cannot leak
        // into the next one.
        startRecognition()
    }

    // MARK: Commands

    func handle(command: [String: Any]) {
        let type = command["type"] as? String ?? ""
        switch type {
        case "ping":
            events.emit("pong", ["at": Date().timeIntervalSince1970])

        case "configure":
            applyConfiguration(command)

        case "start_listening":
            state.async { [weak self] in self?.beginListening(pushToTalk: false) }

        case "listen_once":
            state.async { [weak self] in self?.beginListening(pushToTalk: true) }

        case "stop_listening":
            state.async { [weak self] in self?.endListening() }

        case "speak":
            speak(text: command["text"] as? String ?? "", id: command["id"] as? String)

        case "stop_speaking":
            stopSpeaking()

        case "end_turn":
            // Close any follow-up window and go back to requiring the wake
            // word. This is "we're done talking", not "stop listening".
            state.async { [weak self] in self?.endConversation() }

        case "preview":
            // Audition a voice without changing the configured one. The sample
            // is spoken with that voice's own delivery settings so the picker
            // demonstrates the actual combination, not just the timbre.
            previewVoice(command)

        case "voices":
            emitVoices()

        case "shutdown":
            shutdown()

        default:
            events.fail("Unknown command \"\(type)\"")
        }
    }

    private func applyConfiguration(_ command: [String: Any]) {
        state.async { [weak self] in
            guard let self else { return }
            if let words = command["wakeWords"] as? [String], !words.isEmpty {
                self.config.wakeWords = words.map { $0.lowercased() }
            }
            // Clamped: below ~1s the assistant interrupts people mid-thought,
            // and above ~8s it feels broken.
            if let value = command["silenceTimeout"] as? Double {
                self.config.silenceTimeout = min(8.0, max(1.0, value))
            }
            if let value = command["speechThreshold"] as? Double { self.config.speechThreshold = Float(value) }
            if let value = command["followUpWindow"] as? Double {
                self.config.followUpWindow = min(30.0, max(0.0, value))
            }
            if let value = command["locale"] as? String { self.config.locale = value }
            if let value = command["voice"] as? String { self.config.voiceIdentifier = value }
            if let value = command["speechRate"] as? Double { self.config.speechRate = Float(value) }
            // Clamped to the API's documented ranges. An out-of-range pitch is
            // silently ignored by AVSpeechUtterance, which reads as the setting
            // simply not working.
            if let value = command["pitch"] as? Double { self.config.pitch = min(2.0, max(0.5, Float(value))) }
            if let value = command["volume"] as? Double { self.config.volume = min(1.0, max(0.0, Float(value))) }
            if let value = command["bargeIn"] as? Bool { self.config.bargeInEnabled = value }
            events.emit("configured", [
                "wakeWords": self.config.wakeWords,
                "locale": self.config.locale,
                "bargeIn": self.config.bargeInEnabled,
                "followUpWindow": self.config.followUpWindow,
            ])
        }
    }

    private func beginListening(pushToTalk: Bool) {
        do {
            try ensureEngineRunning()
        } catch {
            events.fail("Could not start audio input: \(error.localizedDescription)", fatal: true)
            return
        }

        if pushToTalk && mode == .command {
            // Already capturing. Restarting here would clear the transcript
            // collected so far and lose the utterance in progress.
            return
        }

        mode = pushToTalk ? .command : .wake
        heardSpeechThisTurn = false
        expectFollowUp = false
        if pushToTalk { armCommandTimers() }
        startRecognition()
        startWatchdog()
    }

    /// End the exchange without closing the microphone: stop speaking, drop any
    /// follow-up window, and go back to waiting for the wake word. This is what
    /// "we're done here" means — distinct from `stop_listening`, which turns
    /// voice off entirely.
    private func endConversation() {
        stopSpeaking()
        expectFollowUp = false
        heardSpeechThisTurn = false
        cancelFollowUpTimer()
        if mode == .command {
            clearCommandTimers()
            mode = .wake
            transcriptAtWake = ""
            lastTranscript = ""
            startRecognition()
        }
        events.emit("turn_ended")
        events.emit("state", ["mode": mode.rawValue, "listening": mode != .idle])
    }

    private func endListening() {
        mode = .idle
        expectFollowUp = false
        heardSpeechThisTurn = false
        watchdog?.cancel()
        watchdog = nil
        clearCommandTimers()
        stopRecognition()
        events.emit("state", ["mode": mode.rawValue, "listening": false])
    }

    // MARK: Speech output

    /// Build an utterance with the current delivery settings, or with a
    /// one-off override so a voice can be auditioned without committing to it.
    private func makeUtterance(_ text: String, override: [String: Any]? = nil) -> AVSpeechUtterance {
        let utterance = AVSpeechUtterance(string: text)
        utterance.rate = (override?["speechRate"] as? Double).map(Float.init) ?? config.speechRate
        utterance.pitchMultiplier = (override?["pitch"] as? Double).map(Float.init) ?? config.pitch
        utterance.volume = (override?["volume"] as? Double).map(Float.init) ?? config.volume
        // A short lead-in stops the first syllable being clipped by the audio
        // device waking up, which is most noticeable on one-word replies.
        utterance.preUtteranceDelay = 0.05
        utterance.prefersAssistiveTechnologySettings = false

        let identifier = (override?["voice"] as? String) ?? config.voiceIdentifier
        if let identifier, let voice = AVSpeechSynthesisVoice(identifier: identifier) {
            utterance.voice = voice
        } else {
            utterance.voice = AVSpeechSynthesisVoice(language: config.locale)
        }
        return utterance
    }

    private func speak(text: String, id: String?) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        let utterance = makeUtterance(trimmed)

        state.async { [weak self] in
            self?.currentUtteranceId = id
            self?.loudFrames = 0
        }
        synthesizer.speak(utterance)
    }

    private func stopSpeaking() {
        guard synthesizer.isSpeaking else { return }
        synthesizer.stopSpeaking(at: .immediate)
    }

    private func previewVoice(_ command: [String: Any]) {
        let sample = (command["text"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
        let text = (sample?.isEmpty == false ? sample! : "Tests passed. You're on the voice branch with three files changed.")
        synthesizer.stopSpeaking(at: .immediate)
        state.async { [weak self] in
            self?.currentUtteranceId = "preview"
            self?.loudFrames = 0
        }
        synthesizer.speak(makeUtterance(text, override: command))
    }

    private func emitVoices() {
        let voices = AVSpeechSynthesisVoice.speechVoices()
            .filter { $0.language.hasPrefix(String(config.locale.prefix(2))) }
            .map { ["identifier": $0.identifier, "name": $0.name, "language": $0.language, "quality": $0.quality.rawValue] as [String: Any] }
        events.emit("voices", [
            "voices": voices,
            "current": config.voiceIdentifier ?? "",
            "rate": Double(config.speechRate),
            "pitch": Double(config.pitch),
            "volume": Double(config.volume),
        ])
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didStart utterance: AVSpeechUtterance) {
        state.async { [weak self] in
            guard let self else { return }
            self.isSpeaking = true
            events.emit("speaking_started", ["id": self.currentUtteranceId ?? ""])
        }
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        finishSpeaking(cancelled: false)
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        finishSpeaking(cancelled: true)
    }

    private func finishSpeaking(cancelled: Bool) {
        state.async { [weak self] in
            guard let self else { return }
            self.isSpeaking = false
            let id = self.currentUtteranceId ?? ""
            self.currentUtteranceId = nil
            events.emit("speaking_finished", ["id": id, "cancelled": cancelled])

            // Audio captured while we were talking was discarded, so a task
            // that predates the utterance may hold a half-heard fragment.
            // Only replace it when there isn't already a fresh one.
            if self.mode != .idle && self.task == nil { self.startRecognition() }

            // Braveli has just answered a request. Keep listening for a beat so
            // the user can reply without re-announcing themselves.
            if self.expectFollowUp && !cancelled && self.mode == .wake {
                self.expectFollowUp = false
                self.openFollowUpWindow()
            }
        }
    }

    func shutdown() {
        endListening()
        stopSpeaking()
        if tapInstalled { engine.inputNode.removeTap(onBus: 0) }
        if engine.isRunning { engine.stop() }
        events.emit("shutdown", [:])
        // Give the writer queue a moment to flush before the process dies.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { exit(0) }
    }
}

// MARK: - stdin loop

let daemon = VoiceDaemon()

/// Reads newline-delimited commands. Runs on its own thread because
/// `readLine` blocks, and the audio and speech callbacks need the main run loop.
func startCommandLoop() {
    Thread {
        while let line = readLine(strippingNewline: true) {
            let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else { continue }
            guard
                let data = trimmed.data(using: .utf8),
                let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            else {
                events.fail("Could not parse command: \(trimmed.prefix(120))")
                continue
            }
            daemon.handle(command: object)
        }
        // stdin closed: Electron is gone, so should we be.
        daemon.shutdown()
    }.start()
}

daemon.requestPermissions { granted in
    events.emit("ready", [
        "granted": granted,
        "backend": "SFSpeechRecognizer",
        "onDevice": SFSpeechRecognizer(locale: Locale(identifier: "en-US"))?.supportsOnDeviceRecognition ?? false,
    ])
}

startCommandLoop()
RunLoop.main.run()
