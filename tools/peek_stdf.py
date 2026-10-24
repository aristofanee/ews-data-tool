import struct, sys, collections

p = sys.argv[1]
d = open(p, 'rb').read()
e = '<'
off = 0
cur_lot = None
cur_wafer = None
dice = 0
tests = {}
samples = []
prr_variants = {'official': 0, 'pystdf': 0}
bad = 0

def cn(buf, o):
    n = buf[o]
    s = buf[o+1:o+1+n].decode('latin1').strip()
    o += 1 + n
    if (1 + n) % 2:
        o += 1
    return s, o

while off + 4 <= len(d):
    ln, typ, sub = struct.unpack_from(e + 'HBB', d, off)
    if ln == 0:
        ln = struct.unpack_from(e + 'I', d, off + 4)[0]
        hdr = 8
    else:
        hdr = 4
    body = d[off+hdr:off+hdr+ln]
    if len(body) < ln:
        print("TRUNCATED at", off); break
    try:
        if (typ, sub) == (1, 10):
            o = 14
            cur_lot, o = cn(body, o)
        elif (typ, sub) == (2, 10):
            o = 6
            cur_wafer, o = cn(body, o)
        elif (typ, sub) == (5, 20):
            dice += 1
            # official: ... TEST_T(4) then PART_ID, PART_TYP, JOB_NAM, NODE_NAM, TST_TEMP, PART_DESC
            o = 16
            ids = []
            for _ in range(6):
                s, o = cn(body, o)
                ids.append(s)
            if dice <= 3:
                print(f"PRR {dice}: len={ln} consumed={o} ids={ids}")
            # verify next header plausible
        elif (typ, sub) == (15, 10):
            tnum = struct.unpack_from('<I', body, 0)[0]
            if tnum not in tests:
                o = 13
                txt, o = cn(body, o)
                alarm, o = cn(body, o)
                o += 1
                res_scal, llm, hlm = struct.unpack_from('<bbb', body, o); o += 3
                lo, hi = struct.unpack_from('<ff', body, o); o += 8
                units, o = cn(body, o)
                rf, o = cn(body, o); lf, o = cn(body, o); hf, o = cn(body, o)
                lo_s, hi_s = struct.unpack_from('<ff', body, o)
                tests[tnum] = (txt, units, lo, hi, lo_s, hi_s, res_scal)
    except Exception as ex:
        bad += 1
        if bad < 5:
            print("ERR", typ, sub, ln, ex)
    off += hdr + ln

print("lot:", cur_lot, "wafer:", cur_wafer, "dice:", dice, "tests:", len(tests), "bad:", bad, "off:", off, "size:", len(d))
for k in list(tests)[:10]:
    print(" ", k, tests[k])
