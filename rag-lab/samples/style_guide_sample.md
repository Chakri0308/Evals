# Lumen Docs Style Guide

Version 3.2. This guide applies to all public documentation, release notes, UI text, and help-center articles published by the Lumen documentation team. Internal engineering design docs are exempt unless they are shared with customers.

## 1. Voice and tone

### 1.1 Be direct

Write in the second person and address the reader as "you". Prefer the active voice: "Click **Save**" rather than "The Save button should be clicked". Lead with the action the reader needs to take, then explain why.

Passive voice is acceptable when the actor is unknown or unimportant, for example "The file is encrypted at rest." It is also acceptable in API reference descriptions of system behavior.

### 1.2 Be warm, not cute

Use a friendly, professional tone. Avoid jokes, puns, and pop-culture references, because they do not translate well and can age badly. Never use exclamation marks in error messages. In onboarding screens, a maximum of one exclamation mark per screen is allowed.

### 1.3 Inclusive language

Use gender-neutral language. Use "they" as a singular pronoun when the gender of a person is unknown. Avoid ableist terms such as "sanity check" (use "quick check" instead) and "crippled" (use "limited" or "disabled"). Replace "whitelist" and "blacklist" with "allowlist" and "denylist", and replace "master/slave" with "primary/replica".

## 2. Grammar and mechanics

### 2.1 Capitalization

Use sentence case for all headings, titles, buttons, and menu items: capitalize only the first word and proper nouns. For example, write "Create a new project", not "Create A New Project".

Exception: product names and feature names that are registered trademarks keep their official capitalization, such as "Lumen Vault" and "QuickSync".

### 2.2 Numbers

Spell out numbers from zero to nine and use numerals for 10 and above. Always use numerals for measurements, percentages, version numbers, and time, even below 10: "5 MB", "3%", "version 2", "4 minutes".

Do not start a sentence with a numeral; rewrite the sentence or spell the number out. Use commas as thousands separators in numbers of four or more digits, for example "1,024 files". Exception: do not use commas in years, port numbers, or error codes, such as "port 8080" or "error 4096".

### 2.3 Dates and times

Write dates in the format "March 7, 2025" in running text. In tables and logs, use the ISO 8601 format YYYY-MM-DD. Use the 12-hour clock with "a.m." and "p.m." in UI text, and always include the time zone, for example "3:00 p.m. UTC". Never use ambiguous formats such as 03/07/25.

### 2.4 Punctuation

Use the serial (Oxford) comma in lists of three or more items: "files, folders, and links". Use the em dash sparingly and without spaces. Do not use semicolons in UI text; split the sentence into two instead.

Put periods at the end of complete sentences in list items. If none of the list items is a complete sentence, omit the periods for all of them. Do not mix the two styles in one list.

### 2.5 Contractions

Contractions such as "don't", "you're", and "it's" are encouraged because they make the text sound natural. However, do not use contractions in legal notices, security warnings, or compliance documentation, where precision matters more than tone.

## 3. Formatting

### 3.1 Headings

Every page must have exactly one H1. Do not skip heading levels (for example, from H2 to H4). Headings must not end with a period. Keep headings under 60 characters.

### 3.2 Lists

Use numbered lists for sequential steps and bulleted lists for non-sequential items. A procedure should have no more than 7 steps; if it needs more, split it into sub-procedures. Each step should contain one action.

### 3.3 Code and UI elements

Format UI elements that the user clicks or selects in **bold**, for example: click **Settings** > **Billing**. Use the right angle bracket (>) with spaces to show menu paths.

Format code, commands, file names, paths, and environment variables in `monospace`. Never put UI labels in monospace. Code blocks must specify a language for syntax highlighting. Commands that the user should type must not include the shell prompt character ($) unless the output is shown in the same block.

### 3.4 Links

Use descriptive link text that tells the reader where the link goes. Never use "click here" or "read more" as link text. Do not link the same destination more than once per section. Links to external sites must open in the same tab, unless the reader is in the middle of a multi-step procedure, in which case they open in a new tab.

### 3.5 Tables

Use tables for reference information that has two or more attributes. Every table needs a header row. Keep tables to a maximum of 5 columns; for more attributes, use a list of definitions instead. Do not put procedures in tables.

## 4. Word choice

### 4.1 Plain language

Prefer short, common words: "use" instead of "utilize", "help" instead of "facilitate", "start" instead of "initiate". Keep sentences under 25 words on average. Explain every acronym on first use, for example "single sign-on (SSO)", except for acronyms that are more familiar than their expansion, such as URL, PDF, and API.

### 4.2 Words to avoid

Avoid "simply", "just", "easy", and "obviously", because what is easy for one reader can frustrate another. Avoid "please" in instructions, except when the user is asked to wait or to do something inconvenient, such as "Please wait while we migrate your data."

Avoid Latin abbreviations: use "for example" instead of "e.g.", "that is" instead of "i.e.", and "and so on" instead of "etc.".

### 4.3 Product terminology

Always write "sign in" (verb) and "sign-in" (noun or adjective). Never use "log in", "login", or "log on" in user-facing text. Exception: when documenting a third-party product whose UI literally says "Log in", match the third-party UI exactly.

The term "workspace" refers to a team's shared container. Do not use "org", "tenant", or "account" as synonyms for workspace. The internal code name "Project Halcyon" must never appear in public documentation; refer to the feature as "Lumen Insights".

### 4.4 Error messages

Error messages have three parts: what happened, why it happened (if known), and what the user can do next. Do not blame the user: write "We couldn't save your file" rather than "You entered an invalid file". Include the error code at the end in parentheses, for example "(LMN-2207)". Error messages must be under 150 characters, excluding the error code.

## 5. Accessibility

### 5.1 Images and alt text

Every informative image needs alt text that describes its purpose, not its appearance. Keep alt text under 125 characters. Decorative images must have empty alt text (alt=""), so that screen readers skip them. Do not start alt text with "Image of" or "Picture of".

### 5.2 Color and contrast

Never use color alone to convey meaning; pair it with an icon or text. Text must have a contrast ratio of at least 4.5:1 against its background, and large text (18 pt or larger) at least 3:1.

### 5.3 Directional language

Avoid directional language that relies on visual layout, such as "the button on the left" or "the menu above". Instead, refer to elements by their label. Exception: directional language is acceptable in instructions for physical hardware, such as "the port on the left side of the device".

## 6. Release notes

Release notes are published every second Tuesday. Each entry starts with a category tag: **New**, **Improved**, **Fixed**, or **Deprecated**. Write release notes in the past tense for fixes ("Fixed an issue where...") and in the present tense for new features ("You can now...").

Deprecation notices must give at least 90 days of notice and must include the removal date and a migration path. Security fixes are described only in general terms until 30 days after the patch ships, so that attackers cannot exploit unpatched systems.

## 7. Conflicts and precedence

When rules in this guide conflict, apply them in this order of precedence:

1. Legal and compliance requirements
2. Accessibility rules (section 5)
3. Product terminology (section 4.3)
4. All other rules

For example, if a legal notice requires the phrase "Log in to the portal", the legal requirement wins over the terminology rule. If a rule conflicts with a customer's own style guide in co-branded content, the customer's guide wins, except for accessibility rules, which always apply.

When this guide is silent on a question, follow the Chicago Manual of Style, 17th edition. For spelling, use Merriam-Webster and American English spelling throughout ("color", not "colour"), even for teams based outside the United States.
