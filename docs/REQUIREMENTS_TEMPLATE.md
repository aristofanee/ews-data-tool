# Plotting App — Requirements

**Project:** EWS Data Tool
**Author / date:** _TBD_ / 2026-10-24
**Status:** Draft

---

## 1. What it is

_One or two sentences. What does the app do, for whom?_

- **Who uses it:** _e.g. product engineers, testing rnd lots, production lots_
- **Main job:** _e.g. load measurement data and turn it into wafer maps, trends and comparison plots_
- **Today they do this with:** _e.g. MATLAB tool_

---

## 2. Functionality

Tick what v1 needs. Add rows as needed.

**Loading data**
- [x] Open local files
- [x] Pick columns and set units
- [x] Filter by lot, wafer, die, date, parameter
- [x] Preview the data before plotting
- [x] Filtering by statistical limits (like IQR/k*sigma etc...)

**Plotting**
- [x] Choose plot type
- [x] Set axes, scale (linear / log), limits
- [x] Group and color by lot / wafer / site / bin
- [x] Show spec limits (LSL / USL) and control limits
- [x] Show a legend and data labels
- [x] Hover a point to see its value and where it came from
- [x] Zoom and pan

**Reuse**
- [x] Save a plot setup as a template
- [x] Apply a template to new data
- [x] Generate the same plot for many wafers/lots at once
- [x] what is really important to me is that some type of analysis requires the same type of plots for the same type of data, i need to have a template file with all the settings and i can just build all the plots for a report in a instant

**Output**
- [x] Export as jpg is fine
- [x] Copy to clipboard
- [x] Export the plotted data
- [x] also if i import the data in a STDF file i should be able to export it in csv and use the tool as a stdf converter
- [ ] _TBD_

---

## 3. Plot types

| Plot | Needed in v1? | Notes |
| --- | --- | --- |
| Line / trend over time or lot | | |
| Scatter with fit line | | |
| Histogram | | |
| Box plot | | |
| Wafer map (pass/fail) | | |
| Wafer map (parameter value) | | |
| Pareto | | |
| Heatmap | | |

**Which 3 plots matter most?**
1. boxplots
2. wafer maps
3. pareto

---

## 4. UX

**Screens**

| Screen | What it does |
| --- | --- |
| 1. Load data | Pick a file or source, choose columns, filter |
| 2. Plot | The chart, with hover, zoom, legend |
| 3. Settings | Plot type, axes, limits, colors |
| 4. Export | Format, size, caption |
| _TBD_ | |

**Rules**
- The first view should show something useful without any configuration.
- Everything reachable in a few clicks — no scripting required for normal use.
- Errors say what went wrong and what to do next.
- _TBD_

**Look and feel**
- _Match existing company style guide? Colors, fonts, logo?_ for now now, if you have to choose use blue and yellow as main colors
- _Light mode only, or dark too?_ both
- _TBD_

---

## 5. Files and data

**Input files**

| Format | Needed? | Notes |
| --- | --- | --- |
| CSV / TXT |yes | |
| STDF / ATDF |yes | |

**Expected columns** (adjust names to your data)

| Column | Example | Needed? |
| --- | --- | --- |
| Lot ID | `24A1234` | |
| OCR | `24A1234-07B` | |
| Product | `AB97ER2` | |
| Wafer ID | `07` | |
| Die X / Die Y | `12, -4` | wafer maps only |
| Parameter name | `Vt_nch` | |
| Value | `0.412` | |
| Timestamp | | |
| HBIN | `1` | |
| SBIN | `1` | |


**Size**
- Typical rows per plot: _TBD_
- Max rows: _TBD_
- Acceptable wait time: _TBD_

**Output files**
- [x] JPG
- [x] CSV of plotted data
- [x] Saved session / template file

---

## 6. Constraints

| Question | Answer |
| --- | --- |
| Desktop app or internal web app? | desktop app |
| Which OS? | w11 |
| Runs offline / air-gapped? | offline |

---


## 8. Tecnichal Requirements

i want the app to be fast, some of the files will be very large (both csv and stdf)
a single lot has 25 wafer every wafer has 4500 dice, this times hundreds of test names. do the math.
and this is just for single lot analysis

i would like to have a small compact binary, rust would be my preferred choice. but i need advanced plotting functionality, interactive plots and i want them to be nice. MATLAB-level of nice. so if you cant do that in Rust you can use python or whatever you want. just be mindful. the quality of the plots is the most important thing. unluckly i cant give example data to work and debug on. try to see if there are open source example of stdf seminconductor files.
