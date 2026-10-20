// Reads what the user is actually looking at, as text.
//
// Prints one JSON object describing the frontmost application, its focused
// window, and the readable text inside that window, then exits.
//
// This exists so "what am I looking at?" does not have to mean "take a
// screenshot and pay a vision model to read it". The accessibility tree is
// already structured, already text, costs nothing to read, and is accurate in
// ways OCR is not — it gets the contents of a scrolled-off terminal line and
// the exact text of an error dialog right. Screenshots stay in the design as a
// fallback for the cases this cannot see, such as a Figma canvas or a video.
//
// Requires the Accessibility permission. Without it this reports
// `trusted: false` and the caller degrades to the screenshot path rather than
// silently returning nothing.

import ApplicationServices
import AppKit
import Foundation

/// Depth and volume caps. An unbounded walk of a large Electron app's tree can
/// take seconds and produce megabytes; the goal here is enough context to
/// explain a screen, not a faithful dump of it.
let maxDepth = 12
let maxElements = 900
let maxCharacters = 12_000

var visited = 0
var collected: [String] = []
var characters = 0

func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success else { return nil }
    return value
}

func stringAttribute(_ element: AXUIElement, _ name: String) -> String? {
    guard let value = attribute(element, name) else { return nil }
    if let text = value as? String { return text }
    // AXValue can wrap a number for things like sliders; those are not useful
    // as prose, so they are skipped rather than stringified.
    return nil
}

func children(of element: AXUIElement) -> [AXUIElement] {
    guard let value = attribute(element, kAXChildrenAttribute as String) else { return [] }
    return (value as? [AXUIElement]) ?? []
}

/// Roles whose own text is worth reading. Containers are walked but not read,
/// which keeps the output from repeating a label once per nesting level.
let textRoles: Set<String> = [
    "AXStaticText", "AXTextField", "AXTextArea", "AXButton", "AXMenuItem",
    "AXCheckBox", "AXRadioButton", "AXLink", "AXHeading", "AXCell", "AXRow",
    "AXTab", "AXPopUpButton", "AXComboBox", "AXValueIndicator",
]

func walk(_ element: AXUIElement, depth: Int) {
    guard depth <= maxDepth, visited < maxElements, characters < maxCharacters else { return }
    visited += 1

    let role = stringAttribute(element, kAXRoleAttribute as String) ?? ""

    if textRoles.contains(role) {
        for attributeName in [kAXValueAttribute as String, kAXTitleAttribute as String, kAXDescriptionAttribute as String] {
            guard let text = stringAttribute(element, attributeName) else { continue }
            let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
            guard trimmed.count > 1, trimmed.count < 4000 else { continue }
            // The same string often appears as both value and title; only the
            // first spelling of it is informative.
            if collected.last == trimmed { break }
            collected.append(trimmed)
            characters += trimmed.count
            break
        }
    }

    for child in children(of: element) {
        walk(child, depth: depth + 1)
    }
}

func emit(_ object: [String: Any]) -> Never {
    let data = (try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])) ?? Data("{}".utf8)
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
    exit(0)
}

let trusted = AXIsProcessTrusted()
guard let frontmost = NSWorkspace.shared.frontmostApplication else {
    emit(["trusted": trusted, "error": "No frontmost application."])
}

var payload: [String: Any] = [
    "trusted": trusted,
    "app": frontmost.localizedName ?? "Unknown",
    "bundleId": frontmost.bundleIdentifier ?? "",
    "pid": frontmost.processIdentifier,
]

guard trusted else {
    payload["error"] = "Accessibility permission has not been granted."
    emit(payload)
}

let application = AXUIElementCreateApplication(frontmost.processIdentifier)

var window: AXUIElement?
if let focused = attribute(application, kAXFocusedWindowAttribute as String) {
    window = (focused as! AXUIElement)
} else if let windows = attribute(application, kAXWindowsAttribute as String) as? [AXUIElement], let first = windows.first {
    window = first
}

guard let window else {
    payload["error"] = "The application exposes no readable window."
    emit(payload)
}

payload["window"] = stringAttribute(window, kAXTitleAttribute as String) ?? ""

// The selected text is the single strongest signal about what the user means
// by "this" — an error they highlighted, a function they are pointing at.
if let focusedElement = attribute(application, kAXFocusedUIElementAttribute as String) {
    let element = focusedElement as! AXUIElement
    if let selection = stringAttribute(element, kAXSelectedTextAttribute as String)?
        .trimmingCharacters(in: .whitespacesAndNewlines), !selection.isEmpty {
        payload["selection"] = String(selection.prefix(4000))
    }
}

walk(window, depth: 0)

payload["text"] = collected.joined(separator: "\n")
payload["elements"] = visited
payload["truncated"] = visited >= maxElements || characters >= maxCharacters

emit(payload)
