# Codex Helper for Gemini CLI

A specialized skill that teaches Gemini CLI how to delegate code reviews, adversarial design checks, and complex tasks to the [OpenAI Codex CLI](https://github.com/openai/codex-plugin-cc).

## Features
- **Smart Code Reviews**: Automatically gathers git diffs and pipes them to Codex.
- **Adversarial Analysis**: Specialized prompts for security and edge-case hunting.
- **Autonomous Delegation**: Allows Gemini to ask Codex for implemention help.
- **Background Support**: Handles long-running tasks via Gemini's native backgrounding.

## Prerequisites
- [Gemini CLI](https://github.com/google-gemini/gemini-cli) installed.
- [Codex CLI](https://github.com/openai/codex-plugin-cc) installed and authenticated (`codex login`).

## Installation

### Option 1: Install from URL (Easiest)
```bash
gemini skills install https://github.com/YOUR_USERNAME/YOUR_REPO/raw/main/codex-helper.skill --scope user
/skills reload
```

### Option 2: Install from Source
1. Clone this repository.
2. Run:
```bash
gemini skills install ./skills/codex-helper --scope user
/skills reload
```

## Usage
Simply ask Gemini:
- "Ask Codex to review my uncommitted changes."
- "Have Codex perform an adversarial review of this branch."
- "Delegate the implementation of the login logic to Codex."
