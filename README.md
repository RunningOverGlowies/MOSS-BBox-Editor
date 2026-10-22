# MOSS-BBox-Editor
> **Bounding-Box Prompting Studio**

Try it out: https://runningoverglowies.github.io/MOSS-BBox-Editor/

A html+js canvas tool for editing and reverse-engineering **MOSS-Image** bounding-box prompts. Drag-in images generated with ComfyUI into the browser window, json prompt is extracted and image shows directly on the canvas.
No dependencies, browser saves prefs. 

* **Drop-in ComfyUI workflow**
* **Palette with auto-color naming**
* **Easy tagging and ordering**
* **Lock/hide elements**
* **Realtime 2-way JSON editor**

<img width="1368" height="972" alt="firefox_Qs9XH02d3H" src="https://github.com/user-attachments/assets/f25a069d-e7a2-4703-93ed-1ee461d0e2a4" />


---

## Controls

| Action | Shortcut / Gesture |
| :--- | :--- |
| **Marquee Multi-Select** | `Shift` + Click & drag on empty canvas |
| **Multi-Select / Toggle** | `Ctrl` / `Cmd` + Click boxes or sidebar cards |
| **Move Group** | Click & drag any selected box |
| **Proportional Scale** | `Shift` + Drag any resize handle |
| **Freeform Resize** | Drag any of the 8 resize handles |
| **Pan Canvas** | Middle-click + drag **or** drag empty canvas |
| **Zoom In / Out** | Mouse Wheel |
| **Delete Selected** | `Delete` or `Backspace` |
| **Undo / Redo** | `Ctrl+Z` / `Ctrl+Y` (or `Cmd+Z` / `Cmd+Shift+Z`) |
| **Import Image / Schema** | Drag & drop file onto page |

---

## MOSS-Image Prompt Schema

The editor builds and validates against this structure:

```json
{
  "width": <integer, multiple of 16>,
  "height": <integer, multiple of 16>,
  "bbox_coord_space": "abs",
  "bbox_format": "xyxy",
  "summary": {
    "canvas": "single" | "multi_panel" | "collage",
    "meta": ["<medium/genre tag>", "<artistic style tag>", "..."],
    "palette": ["<primary color / hex / mood>", "..."],
    "caption": "<Comprehensive visual description of the complete scene, setting, atmosphere, camera, lighting, and overarching composition.>"
  },
  "items": [
    {
      "label": "character" | "object" | "text",
      "caption": "<Detailed description of this item's specific appearance, posture, material, lighting, or typographical styling.>",
      "bbox": [x_min, y_min, x_max, y_max],
      "text": "<Required only if label is 'text'. Literal rendered text with explicit \\n for line breaks.>",
      "tags": ["<descriptive tag>", "..."]
    }
  ]
}
```
