# Security

Pitwall runs coding agents on your machine, sometimes without you watching. Read this before you switch on an automation.

## What an agent can do

An agent session runs the agent's own CLI in a git worktree of your project, with your shell environment and the project's GitHub or GitLab token, so it can push its branch and open a pull request. Whatever that CLI's permission mode allows, the agent can do.

**Anyone who can assign you a ticket, comment on your pull request or ask you for a review is writing text that an agent may read.** Pitwall treats ticket and pull-request text as data, not instructions, but that is a request to the model, not a sandbox. Only switch on automations for trackers and repositories whose contributors you trust.

## What Pitwall enforces itself

- **Drafting is read-only.** An automation's draft is written without running commands or reaching the web, and nothing is posted, pushed or created until you approve it.
- **Reviewers cannot write.** A reviewer agent gets read-only tools, and a Hermes reviewer refuses to start if its guard plugin is not enabled.
- **Tokens stay encrypted.** GitHub and GitLab tokens are stored with macOS safe storage and handed to the agent's environment per session, never to your global git or `gh` configuration.
- **Links open outside the app.** Links an agent prints open in your browser, never inside Pitwall.

## Reporting a vulnerability

Please open a private security advisory on this repository rather than a public issue.
