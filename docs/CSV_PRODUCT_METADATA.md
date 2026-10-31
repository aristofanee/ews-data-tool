# CSV product metadata

The preamble may contain the following records before the detected header.
They use the same delimiter as the CSV table. Names ignore case, punctuation
and underscores.

```csv
Wafer-Diameter,300
Wafer_Height,2.04
Wafer_Width,2.8
Wafer_Flat,D
Wafer_Center_X,0
Wafer_Center_Y,0
SoftBinName,1,Pass
SoftBinName,7,Leakage
LOT_ID,WAFER_ID,DIE_X,DIE_Y,SITE,SBIN,Current
Unit,,,,,,uA
LowL,,,,,,1.5
HighL,,,,,,9.5
L001,W01,1,2,3,7,4.2
```

Diameter and die width/height are in mm. Center coordinates are signed integer
die coordinates. Flat accepts U/D/R/L. Invalid recognized geometry fails the
import rather than silently using a different wafer shape. Soft-bin names
are associated by bin number. Global preamble geometry applies to every wafer
in that CSV; values and limits remain in the units stated by the file.

DIE_X, DIE_Y, SITE, WAFER_ID, LOT_ID, HighL and LowL already match the normalized
alias rules. Metadata immediately beneath the header remains column-aligned.
Interspersed metadata and extended long-table metadata are outside this change.

Missing/blank/invalid bins use reserved internal code 65535 and appear as
Unknown in grey. They are never bin 1. Unknown bins are excluded from Pareto
failure bars and counts; percentages retain the tested-die denominator.
Where unknown bins prevent a complete bin yield, the interface and reports
show N/A. Measurement-based test yield still uses LSL/USL independently.

After loading CSV, the desktop toolbar's **Metadata** button accepts one STDF
or .Z reference file of the same product. It fills missing wafer geometry and
bin descriptions. Existing values are retained, and contradictory reference
geometry is rejected before applying anything. No die rows, coordinates,
measurement values, per-die bins, test limits/units or file provenance are
imported from the reference. The user must select the correct product.
The reference reader skips measurement payloads and allocates no die columns.

CSV performance changes: UTF-8 text stays borrowed from a memory map rather
than making a whole-file String copy; UTF-16 retains the necessary decode
buffer. Imported lot/wafer indices use name caches to avoid repeated linear
searches. CSV parser errors now propagate rather than treating malformed
records as end-of-file. No numeric sampling or measurement reduction is added.

Validation includes the complete example above, exact imported values, aliases,
units/limits, invalid geometry, missing bins and Pareto percentages, plus STDF
metadata extraction and preservation of rows/measurements/existing geometry.
