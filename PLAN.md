# Real-Time Grammar & Spelling Checker

## Core Requirement

The extension MUST analyze text **in real time while the user is typing**.

The user should not need to:

* Click a "Check" button
* Submit a form
* Open the extension popup
* Wait until the entire document is finished

As the user types, errors should automatically appear underneath the relevant text.

---

# 1. Real-Time User Experience

Example:

```text
User types:

I recieved your message.
  ^^^^^^^
  RED LINE
```

The spelling error should appear automatically shortly after the user finishes typing the affected word/sentence.

When corrected:

```text
I received your message.
```

The red underline disappears immediately.

---

# 2. Error Colors

The extension MUST visually distinguish error types.

## Spelling Error

Use a **red underline**.

```text
I recieved your message.
  ~~~~~~~
     RED
```

Meaning:

> The word is probably misspelled.

Examples:

```text
recieve  → receive
teh      → the
definately → definitely
```

---

## Grammar Error

Use a **blue underline**.

```text
She go to school every day.
   ~~
   BLUE
```

Suggestion:

```text
She goes to school every day.
```

Meaning:

> The spelling may be correct, but the sentence contains a grammar problem.

---

## Punctuation Error

Initially, punctuation errors can also use the **blue grammar underline**.

Example:

```text
Hello how are you
     ~
     BLUE
```

Suggestion:

```text
Hello, how are you?
```

---

# 3. Real-Time Processing Pipeline

The expected flow is:

```text
                 USER TYPES
                     │
                     ▼
              Input Event
                     │
                     ▼
              Debounce ~400ms
                     │
                     ▼
           Identify changed text
                     │
                     ▼
          Analyze changed sentence
                     │
             ┌───────┴────────┐
             │                │
             ▼                ▼
         SPELLING           GRAMMAR
         ENGINE              ENGINE
             │                │
             ▼                ▼
           RED              BLUE
         UNDERLINE         UNDERLINE
             │                │
             └───────┬────────┘
                     ▼
              Update Overlay
                     │
                     ▼
              User sees errors
```

The entire process should happen automatically.

---

# 4. Important: Do Not Wait for Enter

This is a strict requirement.

The extension should work while the user is typing:

```text
I recieved
  RED
```

Then:

```text
I recieved your
  RED
```

Then:

```text
I recieved your mesage
  RED             RED
```

The extension continuously updates the detected errors.

---

# 5. Debouncing

Checking on every individual keystroke could cause unnecessary computation.

Use a short debounce.

Recommended starting value:

```typescript
const CHECK_DELAY = 300;
```

or:

```typescript
const CHECK_DELAY = 400;
```

Example:

```text
User types:

I r
I re
I rec
I rece
I recei
I receiv
I receive
I received

          ↓

User pauses ~300–400ms

          ↓

Run checker
```

This still feels real-time to the user while preventing excessive analysis.

---

# 6. Check Only What Changed

Do not re-check a 10,000-word document every time the user types one character.

Instead:

```text
Document
   │
   ▼
Find current sentence
   │
   ▼
Check current sentence
   │
   ▼
Update only affected errors
```

For example:

```text
Paragraph:

The first sentence is correct.
The second sentnce has an error.
The third sentence is also correct.
```

If the user changes:

```text
sentnce
```

only the second sentence should need to be analyzed again.

---

# 7. Error Result Format

The grammar engine should return structured errors.

```typescript
interface GrammarError {
  id: string;

  type: "spelling" | "grammar" | "punctuation";

  start: number;

  end: number;

  originalText: string;

  message: string;

  suggestions: string[];
}
```

Example spelling result:

```json
{
  "type": "spelling",
  "start": 3,
  "end": 10,
  "originalText": "recieve",
  "message": "Possible spelling mistake",
  "suggestions": ["receive"]
}
```

Example grammar result:

```json
{
  "type": "grammar",
  "start": 4,
  "end": 6,
  "originalText": "go",
  "message": "Use 'goes' with 'she'",
  "suggestions": ["goes"]
}
```

---

# 8. Visual Design

## Spelling

```css
.error-spelling {
  text-decoration-line: underline;
  text-decoration-style: wavy;
  text-decoration-color: red;
}
```

Result:

```text
I recieved your message.
  ~~~~~~~
    RED
```

---

## Grammar

```css
.error-grammar {
  text-decoration-line: underline;
  text-decoration-style: wavy;
  text-decoration-color: blue;
}
```

Result:

```text
She go to school.
   ~~
   BLUE
```

---

# 9. Do Not Change the User's Text Automatically

The extension should only underline the error.

Example:

```text
I recieved your mesage.
  RED          RED
```

The user can click the error.

Then show:

```text
┌─────────────────────────┐
│ Spelling mistake        │
│                         │
│ receive                 │
│                         │
│ [Replace]               │
│ [Ignore]                │
│ [Add to dictionary]     │
└─────────────────────────┘
```

For grammar:

```text
┌────────────────────────────┐
│ Grammar suggestion         │
│                            │
│ goes                       │
│                            │
│ [Replace]                  │
│ [Ignore]                   │
└────────────────────────────┘
```

---

# 10. Error Priority

If the same text is reported by multiple engines, the extension should merge the results.

Recommended priority:

```text
Spelling
   ↓
Grammar
   ↓
Punctuation
   ↓
Style
```

A spelling error should not also generate confusing grammar suggestions for the same word unless necessary.

---

# 11. Engine Architecture

Use:

```text
                 Grammar Controller
                         │
          ┌──────────────┴──────────────┐
          │                             │
          ▼                             ▼
      Harper.js                      nspell
          │                             │
          │                         Spelling
          │
      Grammar
      Writing
      Rules
          │
          └──────────────┬──────────────┘
                         ▼
                  Result Normalizer
                         │
                         ▼
                  Error Highlighter
```

### Harper

Primary grammar engine:

https://github.com/Automattic/harper

Harper.js:

https://github.com/Automattic/harper/tree/master/packages/harper.js

WASM:

https://github.com/Automattic/harper/tree/master/harper-wasm

### nspell

Additional local spelling engine:

https://github.com/wooorm/nspell

Dictionary:

https://github.com/wooorm/dictionary-en

---

# 12. Performance Target

The user experience should feel instantaneous.

Target:

```text
Typing
  ↓
300–400ms debounce
  ↓
Local grammar check
  ↓
Update underline
```

Target perceived response:

**< 500ms**

The extension must never block typing while grammar analysis is running.

Use a Web Worker/WASM worker where appropriate:

```text
Main Thread
     │
     ├── User typing
     ├── Cursor
     └── Website UI
          │
          │
          ▼
     Web Worker
          │
          ▼
     Harper WASM
          │
          ▼
     Grammar results
          │
          ▼
     Main Thread
```

This prevents grammar analysis from making the page feel slow.

---

# 13. Definition of "Real-Time"

The MVP is considered successful only if this works:

```text
User:

I recieve
  ↓
Red underline appears

I recieve your
  ↓
Red underline remains

I recieve your mesage
  ↓
Two red underlines

I recieve your mesage yesterday.
  ↓
Grammar analysis runs

User clicks "recieve"
  ↓
Replace with "receive"

Red underline disappears immediately.
```

And:

```text
She go to school.
   BLUE

User clicks suggestion:

She goes to school.

Blue underline disappears.
```

---

# 14. MVP Acceptance Criteria

The extension passes the MVP test when:

* [ ] Errors are detected while typing
* [ ] No manual "Check" button is required
* [ ] Spelling errors receive a red wavy underline
* [ ] Grammar errors receive a blue wavy underline
* [ ] Punctuation errors receive a blue wavy underline
* [ ] Errors update after the user edits text
* [ ] Corrected errors disappear automatically
* [ ] Suggestions appear when an underline is clicked
* [ ] User can replace an error
* [ ] User can ignore an error
* [ ] User can add a word to the dictionary
* [ ] Checking happens locally
* [ ] No text is sent to a cloud API
* [ ] Typing remains responsive
* [ ] Checking works without pressing Enter
* [ ] Checking works without opening the extension popup
* [ ] Checking works in textarea/contenteditable fields
* [ ] Large documents are checked incrementally

---

# 15. Product Principle

The extension should behave like this:

> **Type normally. The extension quietly checks in the background and underlines problems as they appear.**

The user should never have to think about running the grammar checker.

```text
             TYPE
               │
               ▼
        ┌─────────────┐
        │ Background  │
        │ local check │
        └──────┬──────┘
               │
       ┌───────┴────────┐
       │                │
    Spelling          Grammar
       │                │
       ▼                ▼
   🔴 RED LINE      🔵 BLUE LINE
```

This real-time inline experience is a **mandatory MVP feature**, not an optional enhancement.
