# UI mockups

Static, self-contained HTML mockups of the app screens. Open any file directly in a browser;
the only external request is the Inter font from Google Fonts (system font fallback offline).

| File | Screen |
| --- | --- |
| `home.html` | Plays list (populated and empty state), 390x844 phone frame |
| `play-edit.html` | Play UI, edit mode: pitch, collapsible step note, mode toolbar (Pass / Move / Line / Face), step and branch row |
| `web-viewer.html` | Desktop share-link viewer: pitch on the left, step list on the right |

Notes

- The pitch, players and arrows are ported from the design canvas artboards, so positions match the design source.
- The step note pill expands on tap to show the step title plus the outcome description.
- The teal "Tap a target" pill in edit mode is editor guidance, styled apart from play content.
- Present mode is intentionally absent for now; the Play UI ships with edit mode only.
