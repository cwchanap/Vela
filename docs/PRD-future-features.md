# Vela Japanese Learning App - Product Requirements Document

**Version:** 1.0
**Date:** January 2026
**Status:** Draft

---

## Executive Summary

This PRD outlines eight new features for the Vela Japanese learning application. These features address gaps in the current learning experience and expand Vela's capabilities across all four language skills: reading, writing, listening, and speaking practice. The features are designed to complement existing functionality while providing meaningful value to Japanese learners at all proficiency levels.

---

## Table of Contents

1. [Flashcard Review Mode](#1-flashcard-review-mode)
2. [Listening Comprehension Game](#2-listening-comprehension-game)
3. [Vocabulary Tagging & Custom Study Lists](#3-vocabulary-tagging--custom-study-lists)
4. [Contextual Sentence Mining](#4-contextual-sentence-mining)
5. [Reading Passages with Comprehension](#5-reading-passages-with-comprehension)
6. [Grammar Point Lessons](#6-grammar-point-lessons)
7. [Writing Practice](#7-writing-practice)
8. [Social Features](#8-social-features)

---

## 1. Flashcard Review Mode

### Overview

A dedicated flashcard study interface that provides a focused, traditional study experience separate from the gamified quiz modes. Users can review vocabulary on-demand, self-grade their recall, and create targeted study sessions.

### Problem Statement

Users currently learn vocabulary through multiple-choice quizzes, which test recognition but not active recall. Many learners want the ability to study on-demand before tests or during spare time, rather than waiting for SRS-scheduled reviews.

### Target Users

- All Vela users
- Particularly valuable for users preparing for JLPT exams
- Users who prefer traditional study methods over gamification

### User Stories

| ID   | As a... | I want to...                                                          | So that...                                           |
| ---- | ------- | --------------------------------------------------------------------- | ---------------------------------------------------- |
| FR-1 | Learner | Flip through flashcards showing Japanese on front and English on back | I can practice active recall                         |
| FR-2 | Learner | Self-grade my recall using quality ratings (Again, Hard, Good, Easy)  | The SRS adjusts to my actual knowledge               |
| FR-3 | Learner | Start a "cram" session with all my vocabulary                         | I can study before a test regardless of SRS schedule |
| FR-4 | Learner | Filter flashcards by JLPT level                                       | I can focus on exam-relevant vocabulary              |
| FR-5 | Learner | Study cards from my saved dictionaries                                | I can review words I encountered in the wild         |
| FR-6 | Learner | Toggle furigana on/off during study                                   | I can challenge myself appropriately                 |
| FR-7 | Learner | See a session summary after studying                                  | I know how many cards I reviewed and my accuracy     |
| FR-8 | Learner | Reverse card direction (English front, Japanese back)                 | I can practice production, not just recognition      |

### Acceptance Criteria

- Cards display with a flip animation when tapped/clicked
- Quality ratings update the SRS scheduling algorithm
- Cram mode allows reviewing cards not yet due
- Session tracks cards reviewed, correct/incorrect counts, and time spent
- Filter options persist between sessions
- Works offline with previously synced vocabulary

### Success Metrics

- 40% of active users adopt flashcard mode within 30 days
- Average session length of 10+ minutes
- Users report improved recall on subsequent quiz attempts
- Reduction in "Again" ratings over time indicates learning

---

## 2. Listening Comprehension Game

### Overview

An audio-based learning game that plays Japanese speech and asks users to identify meanings, transcribe what they hear, or answer comprehension questions. Leverages the existing text-to-speech infrastructure.

### Problem Statement

Listening is one of the four core language skills, yet the current application has no listening practice. Many JLPT test-takers struggle with the listening section because they lack regular audio exposure and comprehension practice.

### Target Users

- All Vela users, especially JLPT candidates
- Users who consume Japanese media and want to improve comprehension
- Learners who have stronger reading than listening skills

### User Stories

| ID   | As a... | I want to...                                           | So that...                                                 |
| ---- | ------- | ------------------------------------------------------ | ---------------------------------------------------------- |
| LC-1 | Learner | Hear a Japanese word and select its English meaning    | I can practice audio recognition                           |
| LC-2 | Learner | Hear a Japanese sentence and type what I heard         | I can practice dictation skills                            |
| LC-3 | Learner | Adjust playback speed (slow, normal, fast)             | I can train at my current level                            |
| LC-4 | Learner | Replay audio multiple times before answering           | I can catch details I missed                               |
| LC-5 | Learner | See the Japanese text after answering                  | I can verify what was said                                 |
| LC-6 | Learner | Track my listening accuracy separately from reading    | I understand my skill gaps                                 |
| LC-7 | Learner | Filter listening exercises by JLPT level               | I can focus on appropriate difficulty                      |
| LC-8 | Learner | Practice with both vocabulary words and full sentences | I develop both word recognition and sentence comprehension |

### Acceptance Criteria

- Audio plays clearly with visible play/pause controls
- Speed adjustment available: 0.75x (slow), 1.0x (normal), 1.25x (fast)
- Replay button allows unlimited replays before submission
- Dictation mode accepts hiragana, katakana, or romaji input
- Correct answer revealed after submission with audio replay option
- Progress tracked and displayed in user statistics

### Success Metrics

- 30% of active users engage with listening practice weekly
- Average listening accuracy improves 15% over 30 days of use
- Users report feeling more confident with spoken Japanese
- JLPT listening section pass rates improve for active users

---

## 3. Vocabulary Tagging & Custom Study Lists

### Overview

A system for organizing vocabulary with user-defined tags and creating custom study lists. Enables personalized organization of both system vocabulary and user-saved content from the browser extension.

### Problem Statement

Users accumulate vocabulary from various sources (games, saved sentences, browser extension) but have no way to organize this content. Different learners have different goals (work vocabulary, anime terms, JLPT prep) that require personalized organization.

### Target Users

- Power users with large vocabulary collections
- Users preparing for specific contexts (travel, work, exams)
- Users who actively save content via the browser extension

### User Stories

| ID   | As a... | I want to...                                          | So that...                               |
| ---- | ------- | ----------------------------------------------------- | ---------------------------------------- |
| VT-1 | Learner | Create custom tags (e.g., "Work", "N3 Prep", "Anime") | I can categorize my vocabulary           |
| VT-2 | Learner | Apply tags to vocabulary items                        | I can organize my learning content       |
| VT-3 | Learner | Apply multiple tags to a single item                  | Items can belong to multiple categories  |
| VT-4 | Learner | Bulk-tag multiple items at once                       | I can quickly organize large collections |
| VT-5 | Learner | Filter study sessions by tag                          | I can focus on specific topic areas      |
| VT-6 | Learner | See all items with a specific tag                     | I can review my categorized content      |
| VT-7 | Learner | Delete or rename tags                                 | I can maintain my organization system    |
| VT-8 | Learner | Export a tagged list to share with others             | I can help fellow learners               |
| VT-9 | Learner | Auto-suggest tags based on word categories            | Organizing is faster and easier          |

### Acceptance Criteria

- Tags are user-specific and private by default
- Tag names support Japanese characters
- Maximum of 50 tags per user (prevents system abuse)
- Items can have up to 10 tags each
- Tag filters work across flashcard and quiz modes
- Deleting a tag removes it from all associated items
- Export produces a standard format (CSV or JSON)

### Success Metrics

- 25% of users create at least one custom tag
- Tagged vocabulary has higher review completion rates
- Users with tags report better organization satisfaction
- Average of 5+ tags per active tagging user

---

## 4. Contextual Sentence Mining

### Overview

Enhanced browser extension functionality that automatically analyzes saved Japanese text, identifies vocabulary words, provides instant translations, and enables one-click flashcard creation from discovered content.

### Problem Statement

The current browser extension saves raw text but users must manually look up words and create study materials. This friction reduces the value of saved content and leaves potentially valuable learning opportunities untapped.

### Target Users

- Active browser extension users
- Users who read Japanese content online (news, manga, forums)
- Intermediate learners building vocabulary from authentic content

### User Stories

| ID   | As a... | I want to...                                              | So that...                              |
| ---- | ------- | --------------------------------------------------------- | --------------------------------------- |
| SM-1 | Learner | See individual words highlighted when I save a sentence   | I can identify vocabulary to study      |
| SM-2 | Learner | Tap a word to see its dictionary definition               | I understand the meaning in context     |
| SM-3 | Learner | Create a flashcard from a highlighted word with one click | I can quickly build my study deck       |
| SM-4 | Learner | See the sentence context preserved with the flashcard     | I remember where I encountered the word |
| SM-5 | Learner | View the source URL for saved content                     | I can return to the original page       |
| SM-6 | Learner | See difficulty ratings for saved sentences                | I know what level content I'm consuming |
| SM-7 | Learner | Batch-import multiple sentences from a page               | I can efficiently capture content       |
| SM-8 | Learner | Sync extension content to my vocabulary library           | Everything is in one place              |

### Acceptance Criteria

- Japanese text is automatically tokenized into individual words
- Dictionary lookup available for all identified words
- Flashcard creation includes: word, reading, meaning, source sentence
- Source URL and capture date preserved with saved content
- Difficulty score calculated based on vocabulary and kanji usage
- Sync occurs automatically when online, queues when offline

### Success Metrics

- 50% increase in flashcards created from extension content
- Average words identified per saved sentence: 5+
- Users report extension is "more useful" in satisfaction surveys
- Reduction in time between saving content and studying it

---

## 5. Reading Passages with Comprehension

### Overview

A collection of graded reading passages in Japanese with interactive vocabulary support and comprehension questions. Passages are organized by JLPT level and topic, helping learners progress from simple texts to authentic Japanese content.

### Problem Statement

Learners study isolated vocabulary and sentences but lack practice with connected, paragraph-level text. Reading fluency requires exposure to longer passages where context, grammar, and vocabulary work together.

### Target Users

- Learners at all JLPT levels (N5 through N1)
- Users transitioning from textbook Japanese to authentic content
- Users who want structured reading practice with built-in support

### User Stories

| ID   | As a... | I want to...                                           | So that...                            |
| ---- | ------- | ------------------------------------------------------ | ------------------------------------- |
| RP-1 | Learner | Read passages appropriate to my JLPT level             | Content is challenging but achievable |
| RP-2 | Learner | Tap unknown words to see definitions                   | I can read without leaving the app    |
| RP-3 | Learner | Toggle furigana visibility                             | I can adjust difficulty as needed     |
| RP-4 | Learner | Answer comprehension questions after reading           | I verify my understanding             |
| RP-5 | Learner | Listen to the passage read aloud                       | I connect written and spoken forms    |
| RP-6 | Learner | Add unknown words to my vocabulary list                | I can review them later               |
| RP-7 | Learner | Track how many passages I've completed                 | I see my reading progress             |
| RP-8 | Learner | See my reading speed over time                         | I know if I'm improving               |
| RP-9 | Learner | Choose passages by topic (daily life, travel, culture) | I read about things I'm interested in |

### Acceptance Criteria

- Minimum 10 passages per JLPT level at launch
- Each passage has 3-5 comprehension questions
- Word lookup works with conjugated forms, not just dictionary forms
- Audio available for all passages via TTS
- Reading time tracked per passage
- Comprehension scores recorded in progress history
- New passages added monthly

### Success Metrics

- 35% of users complete at least 5 passages per month
- Average comprehension score of 70%+ indicates appropriate difficulty
- Reading speed improvement of 10% over 60 days
- Users report increased confidence reading authentic Japanese

---

## 6. Grammar Point Lessons

### Overview

Structured lessons covering Japanese grammar points organized by JLPT level. Each lesson includes explanations, example sentences, and interactive exercises for practicing grammar patterns.

### Problem Statement

Vocabulary knowledge alone is insufficient for Japanese proficiency. Users need explicit grammar instruction covering particles, verb conjugations, sentence patterns, and grammatical structures to construct and understand sentences.

### Target Users

- JLPT candidates at all levels
- Self-study learners without access to formal classes
- Users who want structured, progressive grammar learning

### User Stories

| ID   | As a... | I want to...                                          | So that...                                |
| ---- | ------- | ----------------------------------------------------- | ----------------------------------------- |
| GP-1 | Learner | Browse grammar points by JLPT level                   | I know what I need to learn for my target |
| GP-2 | Learner | Read clear explanations of each grammar point         | I understand the concept                  |
| GP-3 | Learner | See multiple example sentences per point              | I understand usage in context             |
| GP-4 | Learner | Practice with fill-in-the-blank exercises             | I apply what I learned                    |
| GP-5 | Learner | Transform sentences (e.g., positive to negative)      | I practice conjugation patterns           |
| GP-6 | Learner | Get immediate feedback on exercises                   | I know if I'm correct                     |
| GP-7 | Learner | Ask the AI chat to explain grammar I don't understand | I get personalized help                   |
| GP-8 | Learner | Track which grammar points I've mastered              | I know my progress                        |
| GP-9 | Learner | Review grammar points in spaced intervals             | I retain what I learn                     |

### Acceptance Criteria

- Grammar points cover all JLPT levels (N5-N1)
- Each point includes: explanation, formation rules, 5+ examples, exercises
- Exercises vary in type (multiple choice, fill-blank, transformation)
- AI chat can reference and explain grammar points
- Progress tracking shows mastered vs. needs-review points
- Search functionality for finding specific grammar

### Success Metrics

- Users complete 80% of exercises for started grammar lessons
- Grammar exercise accuracy improves over repeated attempts
- Correlation between grammar study and sentence game performance
- Users report grammar as "clear and understandable"

---

## 7. Writing Practice

### Overview

Canvas-based practice for writing Japanese characters including hiragana, katakana, and basic kanji. Features stroke order guidance, handwriting evaluation, and progressive learning from tracing to free drawing.

### Problem Statement

Character writing builds muscle memory that reinforces recognition. Many learners can read Japanese characters but cannot write them from memory. Writing practice is especially critical for beginners establishing foundational skills.

### Target Users

- Beginners learning hiragana and katakana
- Learners who want to write Japanese by hand
- Users preparing for handwritten portions of exams
- Anyone wanting to reinforce character recognition through writing

### User Stories

| ID   | As a... | I want to...                               | So that...                            |
| ---- | ------- | ------------------------------------------ | ------------------------------------- |
| WP-1 | Learner | See stroke order animations before writing | I learn the correct stroke sequence   |
| WP-2 | Learner | Trace characters with guidance             | I build muscle memory gradually       |
| WP-3 | Learner | Draw characters freely and get feedback    | I know if my writing is recognizable  |
| WP-4 | Learner | Practice all hiragana characters           | I master the basic syllabary          |
| WP-5 | Learner | Practice all katakana characters           | I can write foreign words             |
| WP-6 | Learner | Practice common kanji radicals             | I build foundations for kanji writing |
| WP-7 | Learner | Track my writing accuracy over time        | I see my improvement                  |
| WP-8 | Learner | Use touch or stylus on mobile/tablet       | I can practice on any device          |
| WP-9 | Learner | Focus on characters I struggle with        | I improve weak areas efficiently      |

### Acceptance Criteria

- Covers all 46 hiragana and 46 katakana characters
- Stroke order displayed with numbered steps
- Tracing mode shows ghost character to follow
- Free drawing mode evaluates character similarity
- Works with mouse, touch, and stylus input
- Progress tracked per character (attempts, accuracy)
- Characters can be practiced in random or sequential order

### Success Metrics

- 60% of beginners complete hiragana writing course
- Average accuracy improves from 50% to 80% over practice
- Users report improved character recognition after writing practice
- Correlation between writing practice and vocabulary retention

---

## 8. Social Features

### Overview

Community features including leaderboards, friend connections, study groups, and activity sharing. Creates social motivation and accountability for language learning through friendly competition and collaborative goals.

### Problem Statement

Language learning is often a solitary activity that suffers from motivation challenges. Social features provide external motivation through competition, accountability through peer visibility, and support through community connection.

### Target Users

- Users motivated by competition and comparison
- Learners wanting study partners or accountability
- Users interested in community and shared learning experiences

### User Stories

| ID   | As a... | I want to...                                    | So that...                         |
| ---- | ------- | ----------------------------------------------- | ---------------------------------- |
| SF-1 | Learner | See my ranking on weekly/monthly leaderboards   | I'm motivated by competition       |
| SF-2 | Learner | Add friends and see their activity              | I have study accountability        |
| SF-3 | Learner | Create or join study groups                     | I learn with a community           |
| SF-4 | Learner | Set group goals (e.g., 10,000 XP this week)     | We motivate each other             |
| SF-5 | Learner | See an activity feed of friend achievements     | I celebrate with others            |
| SF-6 | Learner | Share my streaks and milestones                 | I acknowledge my progress publicly |
| SF-7 | Learner | Opt out of leaderboards if I prefer privacy     | I control my visibility            |
| SF-8 | Learner | Challenge a friend to a vocabulary duel         | Competition makes studying fun     |
| SF-9 | Learner | See how my stats compare to similar-level users | I have realistic benchmarks        |

### Acceptance Criteria

- Leaderboards update daily at minimum
- Privacy settings allow full opt-out from social features
- Friend requests require mutual acceptance
- Groups support 2-50 members
- Activity feed shows last 7 days of friend activity
- Inappropriate usernames/content can be reported
- Block functionality for unwanted interactions

### Success Metrics

- 20% of users engage with social features
- Users with friends have 25% higher retention
- Study groups average 5+ members
- Leaderboard participants study 30% more than non-participants

---

## Feature Priority Matrix

| Feature                    | User Impact | Strategic Value | Complexity | Priority |
| -------------------------- | ----------- | --------------- | ---------- | -------- |
| Flashcard Review Mode      | High        | High            | Low        | **P1**   |
| Listening Comprehension    | High        | High            | Medium     | **P1**   |
| Vocabulary Tagging         | Medium      | Medium          | Low        | **P2**   |
| Contextual Sentence Mining | High        | High            | Medium     | **P2**   |
| Reading Passages           | High        | High            | Medium     | **P2**   |
| Grammar Lessons            | High        | High            | High       | **P3**   |
| Writing Practice           | Medium      | Medium          | High       | **P3**   |
| Social Features            | Medium      | Medium          | High       | **P4**   |

---

## Dependencies and Constraints

### Cross-Feature Dependencies

- **Flashcard Review Mode** is foundational for vocabulary tagging and sentence mining
- **Vocabulary Tagging** enhances flashcard filtering and reading passage integration
- **Sentence Mining** feeds into flashcard mode and vocabulary tagging
- **Grammar Lessons** can reference reading passages for context
- **Social Features** integrate with all progress tracking systems

### Content Requirements

- Reading passages require content creation or licensing
- Grammar lessons require curriculum development
- Writing practice requires stroke order data for all characters

### External Dependencies

- Listening comprehension requires reliable TTS audio generation
- Sentence mining requires Japanese tokenization capability
- Writing recognition may require ML model or API integration

---

## Success Criteria Summary

The feature set will be considered successful if:

1. **Engagement**: 50% of active users engage with at least one new feature monthly
2. **Retention**: 30-day retention improves by 15%
3. **Learning Outcomes**: Users self-report improved Japanese proficiency
4. **Satisfaction**: NPS score of 50+ from feature users
5. **Coverage**: All four language skills (reading, writing, listening, speaking practice via chat) have dedicated features

---

## Open Questions

1. Should grammar lessons be gated by subscription or included in free tier?
2. What is the content strategy for reading passages (original creation vs. licensing)?
3. Should social features support Japanese-only chat for immersion?
4. What languages should UI support for international learners of Japanese?
5. Should writing practice include kanji beyond basic radicals?

---

## Revision History

| Version | Date         | Author | Changes       |
| ------- | ------------ | ------ | ------------- |
| 1.0     | January 2026 | Claude | Initial draft |
