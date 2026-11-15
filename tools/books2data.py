# mate-books 저장소의 교재 원고를 메이트랩 data/*.js로 바꾼다.
# 사용: git clone --depth 1 https://github.com/kimdongwanclass/mate-books /home/claude/mate-books && python3 tools/books2data.py /home/claude/mate-books
import json,glob,re,sys,os
import pathlib
MB=sys.argv[1] if len(sys.argv)>1 else '/home/claude/mate-books'
OUT=str(pathlib.Path(__file__).resolve().parent.parent/'data')
HDR=("/* 메이트랩 단어 데이터 — 원본은 GitHub mate-books 저장소. 메이트랩이 웹 원본이고 강사 포털·스태프웹은 "
     "https://mate-lab.netlify.app/data/ 에서 읽어 쓴다.\n   항목: [표제어, 보조(한자/품사), 빈도(★ 수), 분류(DAY·테마), 뜻, 예문, 출처, 예문 풀이, 교재 번호] */\n")
def dump(var,rows,comment):
    with open(f'{OUT}/{var.lower()}.js','w',encoding='utf-8') as f:
        f.write(HDR+f"/* {comment} */\nconst {var} = [\n")
        last=None; lines=[]
        for r in rows:
            if r[3]!=last: lines.append(f"/* {r[3]} */"); last=r[3]
            lines.append(json.dumps(r,ensure_ascii=False)+",")
        f.write("\n".join(lines).rstrip(",")+"\n];\n")
# 국어
def ko(folder,var,comment,themes):
    rows=[];n=0
    files=sorted(glob.glob(f'{MB}/{folder}/day[0-9][0-9].py'))
    for fp in files:
        d=int(re.search(r'day(\d+)',fp).group(1)); ns={}; exec(open(fp,encoding='utf-8').read(),ns)
        t=f"{d:02d} "+themes[d].replace(" · ","·")
        for e in ns['E']:
            n+=1; w,hj,m,ex,src,tr,note=e
            rows.append([w,hj,0,t,m,re.sub('[【】]','',ex),src,tr,n])
    dump(var,rows,comment); return len(files),n
ns={};exec(open(f'{MB}/gojeon-eohwi-0630/data_plan.py').read(),ns); T1={p[0]:p[1] for p in ns['PLAN']}
L=json.load(open(f'{MB}/pilsu-eohwi-1114/편성안_DAY40.json')); T2={x['day']:x['theme'] for x in L}
print('ko',ko('gojeon-eohwi-0630','KO',"국어 『고전 어휘 0630』(메이트국어연구소) 20 DAY",T1))
print('k2',ko('pilsu-eohwi-1114','K2',"국어 『필수 어휘 1114』(메이트국어연구소) 40 DAY",T2))
# 영어
POS={'대':'pron.','명':'n.','동':'v.','형':'adj.','부':'ad.','전':'prep.','접':'conj.'}
unk=set()
def en(stage,var,label):
    rows=[]; files=sorted(glob.glob(f'{MB}/english-vocab/data/{stage}_day*.json'))
    for fp in files:
        d=json.load(open(fp,encoding='utf-8'))
        for e in d['entries']:
            ps=[];ms=[]
            for s in e['senses']:
                p=POS.get(s.get('pos') or '', None)
                if s.get('pos') and p is None: unk.add(s['pos'])
                ps.append(p or ''); ms.append(", ".join(((it.get('pre')+' ') if it.get('pre') else '')+it['t'] for it in s['items']))
            sub="/".join(ps) if all(ps) else ""
            m=" / ".join(ms)
            ex=e['ex'][0] if e.get('ex') else {'en':'','ko':''}
            rows.append([e['word'],sub,e.get('star','').count('★'),f"DAY {d['day']}",m,ex['en'].replace('**',''),f"{label} · DAY {d['day']}",ex['ko'],e['no']])
    dump(var,rows,f"MATE VOCA {label} (메이트영어연구소)"); return len(files),len(rows)
print('gb',en('gibon','GB','기본')); print('ps',en('pilsu','PS','필수')); print('ws',en('wanseong','WS','완성')); print('unknown pos',unk)
