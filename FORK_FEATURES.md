# What this fork adds

This is the guide to everything the [BlueCheeseburger fork](https://github.com/BlueCheeseburger/cardmirror)
of CardMirror does that the original ([`ant981228/cardmirror`](https://github.com/ant981228/cardmirror))
doesn't. Each section says what the feature is, how to use it, and which
setting turns it on or off.

Settings are written as **Settings → Tab → Section** (open Settings with
**Ctrl+,** or **⌘,**, and use its search box to find any setting by name). A
setting marked "on by default" needs nothing from you. The full day-by-day list
of changes is in [CHANGELOG.md](./CHANGELOG.md), and the long technical version
is in [DETAILED_CHANGELOG.md](./DETAILED_CHANGELOG.md). The complete manual is
[MANUAL.md](./MANUAL.md).

**On this page**

1. [Independent windows and a three-pane workspace](#1-independent-windows-and-a-three-pane-workspace)
2. [Pace guides: on time, too slow, too fast](#2-pace-guides-on-time-too-slow-too-fast)
3. [Paced auto-scroll](#3-paced-auto-scroll)
4. [Flow and lay read times](#4-flow-and-lay-read-times)
5. [Compare and merge documents](#5-compare-and-merge-documents)
6. [Autosave for Word files](#6-autosave-for-word-files)
7. [Logos card search](#7-logos-card-search)
8. [Search your own cards](#8-search-your-own-cards)
9. [A redesigned Save As](#9-a-redesigned-save-as)
10. [Mark Card and Marked Doc](#10-mark-card-and-marked-doc)
11. [Stars and Starred Doc](#11-stars-and-starred-doc)
12. [The outline's right-click menu](#12-the-outlines-right-click-menu)
13. [Print](#13-print)
14. [The document bar, the speech doc and the file badge](#14-the-document-bar-the-speech-doc-and-the-file-badge)
15. [More AI tools](#15-more-ai-tools)
16. [A friendlier ribbon](#16-a-friendlier-ribbon)
17. [Default text style and custom styles](#17-default-text-style-and-custom-styles)
18. [The keyboard map](#18-the-keyboard-map)
19. [Smaller things](#19-smaller-things)

---

## 1. Independent windows and a three-pane workspace

Every window is its own workspace. One window can be a single document, another
can show three documents side by side, and each keeps its own open files and
layout. In the original, all windows had to share one layout.

**How to use it**

- **Turn the three-pane layout on or off** for a window from the ribbon's layout
  button.
- **Move a document between panes:** grab a pane's title chip and drag it. A strip
  appears along the bottom of the window with one tile for each pane (marked
  **Add to stack** or **Move here**), a **New window** tile, and a tile for every other open
  window. Drop on one. Panes you can drop on light up as you drag. Dropping on a pane
  that already has a document adds yours to that pane's stack (**Ctrl-Tab** steps through
  it); to make it swap the two instead, turn on **Settings → General → Workspace →
  Dropping a document on an occupied pane swaps instead of stacking**.
- **Send a document to another window:** drop it on that window's tile. Unsaved
  edits travel with it.
- **Minimize a pane:** hold **Alt** and click the pane's expand button. A small
  **N hidden** chip next to the search icon brings them back.
- **Opening a fourth document** while all three panes are full offers **New window**
  next to the pane picker.
- **Name a window** (handy for telling windows apart): right-click the ribbon and
  choose to name it. The name replaces the file name in the title bar.

## 2. Pace guides: on time, too slow, too fast

While the speech clock runs, CardMirror tells you whether you're keeping up with
your document, so you don't have to do the math on the timer.

- **On time / Too slow / Too fast.** The timer compares the time left on the clock
  with how long the rest of your document takes to read at the steady pace that
  fits the *whole* document into the *whole* speech, so you start **On time**
  whatever the document's length. It shows as words under the timer, or as a small
  dot that shades from red through green to blue.
- **Time left.** The first reader's **Left 3:07** (what's still unread) sits in a
  small line under the timer's digits, inside the timer's box.
- **A blue line beside the document.** A thick blue line in the margin between the
  outline and your document starts at the top and glides down at that same pace, so
  you can see where you *should* be reading. It stays when you pause and goes away
  when you reset the clock. If your document is more than a minute longer than the
  speech (probably a masterfile) it stays hidden.

It works in read mode and Reading view, follows the lay-speaking toggle, and counts from the line
you're actually reading, a third of the way down the screen.

**Settings:** **Settings → Appearance → Timer display → Show pace guides** (on by
default) turns the time-left line and the blue line on or off together. The time
left also needs **Settings → General → Word counts → Live read time for what is left
to read**. Set your reading speed under **Readers for read-time estimates** in the
same section.

## 3. Paced auto-scroll

A hands-free teleprompter. Press the **Auto-Scroll** button in the ribbon and the
document scrolls at *your* reading pace: slower over dense highlighted text, faster
through everything you skip. It works in read mode and Reading view (where it turns the pages) and follows the lay-speaking
toggle. A thin outlined bar in the margin marks the line it thinks you're reading.

Press **Escape**, any scroll key (PageUp, PageDown, Home, End, the arrow keys), or
scroll yourself to stop it.

## 4. Flow and lay read times

Give each reader two speeds: the usual (flow) speed and a slower lay-speaking one.

- **Switch between them:** click a pane's read time. The choice is remembered for
  that saved file, even after you close it or restart CardMirror.
- **Word Count Selection** (the Σ button) shows both flow and lay times when both
  speeds are set.
- **Right-click a heading in the outline** to see how long readers 1 and 2 take to
  read it and everything under it.
- Pocket, hat and block titles count toward every read time, at your tag speed.

**Settings:** **Settings → General → Word counts → Readers for read-time estimates**.

## 5. Compare and merge documents

Find out exactly what changed between two files: this season's file against last
season's, your partner's edit against yours, or a file before and after cutting.

1. On the Home screen, click **Compare documents** (or press **3**).
2. Choose two `.cmir` or `.docx` files and click **Compare**.
3. The two files appear side by side, line by line. Lines only in the first are
   red, lines only in the second are green, and edited lines show the changed
   words struck through on the left and underlined on the right. Each side has an
   outline (green for added, red for removed, yellow for partly changed) to jump
   to a heading.
4. Click **Merge** to combine the two into one new document. Lines both files share
   are kept once; for an edited line you pick the first version, the second, or both.

Neither file is opened or changed by comparing them.

**From a sync conflict:** when a Dropbox, OneDrive or similar file changes under
you, click the pill at the bottom of the document and choose **See what changed**
to compare their version with yours before deciding; on a conflicted copy, choose
**Compare with the original**. The two open already loaded, with Merge available,
and nothing changes until you pick Keep their changes, Keep my changes or Keep both.

## 6. Autosave for Word files

Autosave covers `.docx` files, not just `.cmir`. The ribbon's **Autosave** button
tells you whether it is **saving** or **paused** (for example, when a live view
means Word can't hold the file open). Click the button to turn it on or off for the
document.

## 7. Logos card search

Search Logos, a search engine over the round documents college and high school
teams open-source on opencaselist, and drop a full card into your document.

1. Open **Search Everything** (the magnifying-glass button at the bottom left, or
   its shortcut).
2. Type **g**, a space, then your search.
3. Press **Enter** to insert the card at your cursor with its cite, underlining and
   highlighting intact. Right-click a result to read the card first.

**Settings:** **Settings → Editing → Cards from Logos** can condense, shrink and
recolor every card as it lands.

## 8. Search your own cards

Type **q**, a space, then your search in Search Everything. It searches your Quick
Cards (badge **QUICK**) and the cards inside your indexed files (badge **CARD**) at
once. Right-click any result to read the full card first; a card from a file shows
the file's name and path. Cards in your files are indexed when the app opens, so
results are ready right away. Search Everything works on every screen, including
ones with no open document; picking a card there opens it as a new document.

## 9. A redesigned Save As

Save As is a list you choose from instead of buttons that save the moment you
click. Pick a mode, pick a location, then press **Save As** and both apply
together.

- **Modes:** **As-Is**, **Send Doc**, **Read Doc**, **Marked Doc**, **Starred Doc**
  and **Custom Save** (its options appear inline). Marked Doc tells you how many
  cards are marked.
- **Locations:** a remembered folder, or **Choose location when saving**.
- **Number keys:** every choice, and the "Save before closing?" dialog, shows a
  number on its button. Press the number to pick it. In Save As, use **Alt+number**
  while the cursor is in the Name field.

**Settings:** **Settings → Files → Send / Read / Marked docs** sets each mode's
file-name prefix, folder and format.

## 10. Mark Card and Marked Doc

Mark the card you just read, so you (and the other team) can find it later.

- **Mark Card:** press **Mod-Alt-D** with your cursor in a card (rebind it on the
  [keyboard map](#18-the-keyboard-map)). It drops a red "Marked" note at the end of
  the card; run it again to unmark. It works in read mode.
- **During a speech,** the note says how far into the speech you are ("Marked at
  2:15"), so you can say it out loud.
- **In the outline,** a red flag sits before every marked card, and each pocket, hat
  or block shows a red "N marked" count.
- **Marked Doc** (in Save As) saves a copy of just the marked cards.

## 11. Stars and Starred Doc

Star the headings and cards you want to keep, then save only those.

- **Star something:** hover a hat, block, card or analytic in the outline and click
  the star at the left of its row. Starred rows show a filled star.
- **Starred Doc** (in Save As) saves a copy with only your starred items.

Stars are saved in `.cmir` files. A `.docx` does not keep them.

## 12. The outline's right-click menu

Right-click a heading in the outline for a menu that acts on that heading and
everything under it. Select several headings first and it acts on all of them.

- **Cut, Copy and Delete** the heading and its contents.
- **Card ▸** (hover for the submenu): Condense, Create Reference, Extract Undertag,
  Lock Highlighting, Unhighlight Card (it becomes **Rehighlight Card** afterwards),
  highlight and background conversions, and Shrink.
- **Doc ▸** (on pockets, hats and blocks): the same cleanup and highlighting tools
  as the ribbon's **Doc** menu, but applied only to that part of the document.
- **Read times** for readers 1 and 2 at the bottom.

Each action is one undo step.

## 13. Print

**Print…** (**Mod-Alt-P**, or File → Print… on macOS) prints the document through
your computer's own print dialog, so you can pick a printer or "Save as PDF". What
prints is what you see: highlighting, underlining, emphasis boxes and card numbers
included, with a card kept on one page when it fits. A dark-theme document prints
in light colors. Turn **read mode** on first for a short read-aloud copy.

## 14. The document bar, the speech doc and the file badge

- **A single window looks like one pane:** the blue document bar with the file name
  sits above your document, as it does in the three-pane workspace.
- **Pick your speech doc:** hover a document bar and a grey microphone appears.
  Click it to make that document the active speech doc.
- **The file badge** at the bottom of each pane shows the file's location with a
  cloud icon (Dropbox, OneDrive, Google Drive or iCloud) or a computer icon. Click it
  to reveal the file, drag it out to share the file, or right-click to copy its path
  (including the path inside your cloud folder).
- **Names never show `.docx` or `.cmir`,** and renaming starts from the plain name.

## 15. More AI tools

Everything here needs an AI provider set up under **Settings → Comments & AI**.
Gemini is added as a third provider alongside Anthropic Claude and OpenRouter.

- **Cross-Ex Practice** (target button next to the comments buttons): writes 3 to
  6 questions an opponent would ask about your file, with a clickable cite that
  jumps to the card. It sends only headings, tags, cites, analytics and highlighted
  text, never the unhighlighted card text.
- **Card Credibility** (shield button): scores every card 0 to 10 from its tag and
  cite only, with a short reason and **Jump to card**. Weak cards get a **Press**
  attack. **Deeper analysis** opens a card full screen beside a conversation with
  the AI.
- **Replies stream in** as they are written, and answers to **Ask AI** questions can
  use bold and italic.

## 16. A friendlier ribbon

Small changes that make CardMirror easier to learn:

- **Extra formatting buttons** (on by default): Undo, Redo, bold, italic, underline,
  strikethrough, superscript, subscript, Table, Insert image and the card
  numbering buttons. Turn them off at **Settings → Appearance → Theme & chrome →
  Show extra formatting buttons**.
- **Key hints:** each style button (Pocket, Hat, Block, Tag, Cite, Underline,
  Emphasis…) shows its F-key in the corner.
- **A visible Search button** (a magnifying glass at the bottom left) opens Search
  Everything, with a hint that the letter (`g`, `q`…) goes first.
- **A cleaner Home screen:** New document, Open… and Compare documents.
- **The outline follows you:** the heading you're in stays highlighted as you scroll.
- **Remove Emphasis:** **Mod-F10** takes Emphasis off the selected text, the way
  **Mod-F11** takes highlighting off. The words stay underlined.

## 17. Default text style and custom styles

- **Default text style:** new documents start on a line in the style you choose,
  so you can type straight into the style you use most. Pick any of Pocket, Hat,
  Block, Tag, Analytic (the default), Undertag or a plain paragraph from one
  drop-down at **Settings → Files → New documents → Default text style**.
- **Custom styles:** define your own character styles (a color, bold, underline…)
  and give each one a key. **Settings → Editing → Custom styles**.

## 18. The keyboard map

**Settings → Keyboard** opens a picture of your keyboard showing what every key
does right now. Click a key and use the picker to change what it does, or choose
**Nothing (unassigned)** to clear it. Under the map, every command has a row for
adding a key (**+**), removing one (**×**) and restoring the default. Macros are at
the bottom. While a dialog is open, shortcuts don't touch the document behind it;
you'll see "Close this dialog first."

## 19. Smaller things

- **What's new:** after an update, a pop-up shows the release notes. You can reopen
  them any time from **Settings → General → About this install → What's new**.
- **Linux installers** (`.AppImage`, and `.pacman` for Arch) come with every
  release, along with the Mac and Windows installers.
- **Recover Previous Version** works for Word (`.docx`) documents.
- **Reload From Disk** reloads only the focused pane, and a missing file shows the
  red notice in the bottom bar.
- **Read mode** shows no red spelling squiggles.
- **Highlight underlined text only:** **Settings → Editing → Highlighting** makes
  every highlight command skip text that isn't underlined.
- **Open Settings** with **Ctrl+,** or **⌘,**.
- **Compact timer layout:** **Settings → Appearance → Timer display**.
