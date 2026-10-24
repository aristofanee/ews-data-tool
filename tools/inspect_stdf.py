import sys, struct, collections

NAMES = {(0,10):'FAR',(1,10):'MIR',(1,20):'MRR',(1,30):'PCR',(1,40):'HBR',(1,50):'SBR',(1,100):'SDR',
         (2,10):'WIR',(2,20):'WRR',(2,30):'WCR',(5,10):'PIR',(5,20):'PRR',
         (15,10):'PTR',(15,20):'MPR',(15,30):'FTR',(15,40):'STR',(20,10):'TSR',
         (50,10):'GDR',(50,20):'DTR',(0,20):'ATR'}

def detect(data):
    for e in ('<', '>'):
        ln, typ, sub = struct.unpack_from(e + 'HBB', data, 0)
        if typ == 0 and sub == 10 and ln == 2:
            ver = data[5]
            if ver == 4:
                return e
    return '<'

def scan(path):
    data = open(path, 'rb').read()
    e = detect(data)
    off = 0
    counts = collections.Counter()
    while off + 4 <= len(data):
        ln, typ, sub = struct.unpack_from(e + 'HBB', data, off)
        hdr = 4
        if ln == 0:
            if off + 8 > len(data):
                break
            ln = struct.unpack_from(e + 'I', data, off + 4)[0]
            hdr = 8
        if ln > len(data) - off - hdr:
            print(f"  !! truncated record at {off} typ={typ} sub={sub} len={ln}")
            break
        counts[(typ, sub)] += 1
        off += hdr + ln
    return e, counts, len(data), off

for p in sys.argv[1:]:
    e, c, size, end = scan(p)
    print(f"== {p}  size={size}  endian={e}  parsed={end}")
    for (t, s), n in sorted(c.items()):
        print(f"   {NAMES.get((t,s), f'{t}/{s}'):6s} ({t},{s}): {n}")
