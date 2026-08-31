# Handoff

Load the unpacked extension from `minimal/` in `chrome://extensions`.

Current features:

- Downloads Instagram post images and videos, reels, and stories.
- Names files with the post owner's username prefix and the Instagram media ID.
- Uses `.jpg` for images and `.mp4` for videos based on Instagram metadata.
- Download button state colors: blue, orange while downloading, green on success, red on failure.
- Press `S` to download the visible item whose download button is nearest the viewport centre. The shortcut is disabled while typing.
- Carousel feed downloads first match the currently rendered image URL to API carousel candidates; dot and slide detection are fallbacks.
- Right-clicking a large Instagram image exposes Chrome's native image menu for **Save image as** and **Open image in new tab**.

Known limitation:

- Chrome's Download bubble is browser UI. An extension cannot suppress or control its focus.

Before further changes, reload the unpacked extension and test feed carousel, reel, story, and right-click behavior independently.
