// Interface language: English (built in) or Bahasa Indonesia. Strings are translated where they appear
// (text, placeholders, titles, labels) by exact match, so pages need no changes. Chats are never touched:
// the agents answer in whatever language you write in.
const LANGS=[['en','English'],['id','Bahasa Indonesia']];
const ID={
 // navigation
 'Chat':'Obrolan','Agents':'Agen','Automations':'Otomatisasi','Abilities':'Kemampuan','Models':'Model','System':'Sistem','Files':'File',
 'Schedules':'Jadwal','Channels':'Saluran','Webhooks':'Webhook','Pairing':'Pemasangan','Kanban':'Kanban','Skills':'Keahlian','MCP tools':'Alat MCP','Plugins':'Plugin',
 'Memory':'Memori','Achievements':'Pencapaian','Accounts':'Akun','Keys':'Kunci','Status':'Status','Usage':'Pemakaian','Logs':'Log','Settings':'Pengaturan','Host':'Server','People':'Orang',
 'Each agent has its own name, picture, personality, model, skills, memory and chats.':'Setiap agen punya nama, foto, kepribadian, model, keahlian, memori, dan obrolannya sendiri.',
 'Prompts that run on a timetable and deliver the result where you want it.':'Perintah yang berjalan sesuai jadwal dan mengirim hasilnya ke tempat yang kamu mau.',
 'Talk to aqeelOS from Telegram, Discord, WhatsApp, email and more.':'Bicara dengan aqeelOS dari Telegram, Discord, WhatsApp, email, dan lainnya.',
 'Let other services trigger aqeelOS with an event.':'Biarkan layanan lain memicu aqeelOS dengan sebuah kejadian.',
 'Approve who can message aqeelOS on your channels.':'Setujui siapa yang boleh mengirim pesan ke aqeelOS di salurannmu.'.replace('salurannmu','saluranmu'),
 'A board of tasks your agents pick up and work through on their own.':'Papan tugas yang diambil dan dikerjakan agenmu sendiri.',
 'Reusable know-how aqeelOS can pick up for a task.':'Pengetahuan yang bisa dipakai ulang oleh aqeelOS untuk sebuah tugas.',
 'Outside tools aqeelOS can call, like GitHub, Notion or databases.':'Alat luar yang bisa dipanggil aqeelOS, seperti GitHub, Notion, atau database.',
 'Extensions for aqeelOS itself, such as model providers.':'Tambahan untuk aqeelOS sendiri, seperti penyedia model.',
 'Files on the AI box that aqeelOS works with.':'File di server AI yang dipakai aqeelOS.',
 'What aqeelOS remembers about you between chats.':'Apa yang diingat aqeelOS tentang kamu di antara obrolan.',
 'Badges for what you and your agents have done, from your whole history.':'Lencana untuk apa yang sudah kamu dan agenmu lakukan, dari seluruh riwayat.',
 'Which AI does the thinking, and how hard it thinks.':'AI mana yang berpikir, dan seberapa keras ia berpikir.',
 'Every account that does the thinking: how much is left, which one is used first, and which agent uses what.':'Semua akun yang berpikir: sisa kuota, mana yang dipakai duluan, dan agen mana memakai apa.',
 'API keys and tokens, stored on the box and never shown in full.':'Kunci API dan token, disimpan di server dan tidak pernah ditampilkan utuh.',
 'Is everything running, and what happened recently.':'Apakah semuanya berjalan, dan apa yang terjadi baru-baru ini.',
 'Tokens, cache and cost over time.':'Token, cache, dan biaya dari waktu ke waktu.',
 'What aqeelOS wrote while working.':'Catatan aqeelOS saat bekerja.',
 'Every aqeelOS setting, grouped and searchable.':'Semua pengaturan aqeelOS, dikelompokkan dan bisa dicari.',
 'The AI box itself: resources, updates and maintenance.':'Server AI itu sendiri: sumber daya, pembaruan, dan perawatan.',
 'Who can sign in, what they can do, and which agents they can use.':'Siapa yang bisa masuk, apa yang bisa mereka lakukan, dan agen mana yang bisa mereka pakai.',
 'Your own folder. Your agents can read what you put here.':'Folder milikmu. Agenmu bisa membaca apa yang kamu taruh di sini.',
 // chat
 'New chat':'Obrolan baru','Search chats':'Cari obrolan','Chats':'Obrolan','Automation':'Otomatis','All':'Semua','Manage chats':'Kelola obrolan','Today':'Hari ini','Yesterday':'Kemarin',
 'Good morning':'Selamat pagi','Good afternoon':'Selamat siang','Good evening':'Selamat malam','No chats yet.':'Belum ada obrolan.',
 'Effort':'Usaha','Thought':'Berpikir','Thinking…':'Sedang berpikir…','Use a tool':'Pakai alat','MCP tools':'Alat MCP','Built-in tools':'Alat bawaan','Manage tools…':'Kelola alat…',
 'Attach images':'Lampirkan gambar','Steer now':'Arahkan sekarang','Queue next':'Antrekan',
 // account menu and common
 'Your profile':'Profil kamu','Light mode':'Mode terang','Dark mode':'Mode gelap','Keyboard shortcuts':'Pintasan keyboard','Development board':'Papan pengembangan','Sign out':'Keluar','Language':'Bahasa',
 'Refresh':'Muat ulang','Save':'Simpan','Cancel':'Batal','Close':'Tutup','Delete':'Hapus','Remove':'Hapus','Add':'Tambah','Done':'Selesai','Rename':'Ganti nama','Edit':'Ubah','Search':'Cari','Back':'Kembali',
 'Search or run a command':'Cari atau jalankan perintah','Sign in':'Masuk','Username':'Nama pengguna','Password':'Kata sandi','Your password':'Kata sandi kamu','Welcome back':'Selamat datang kembali','Sign in to aqeelOS.':'Masuk ke aqeelOS.',
 'Name':'Nama','Change picture':'Ganti foto','Current password':'Kata sandi sekarang','New password':'Kata sandi baru','Leave both empty to keep your password.':'Kosongkan keduanya untuk tetap memakai kata sandi lama.','You sign in with your username.':'Kamu masuk dengan nama pengguna.',
 'Invite someone':'Undang seseorang','Share an agent':'Bagikan agen','Allowed to':'Boleh','Can chat':'Bisa mengobrol','Can edit':'Bisa mengubah','Owner':'Pemilik','Member':'Anggota','Admin':'Admin',
 'New agent':'Agen baru','New schedule':'Jadwal baru','New task':'Tugas baru','Add account':'Tambah akun','Add Claude account':'Tambah akun Claude','Add a key':'Tambah kunci',
 'Priority':'Prioritas','Switch automatically':'Pindah otomatis','Which agent uses what':'Agen mana memakai apa','All accounts':'Semua akun','Used by':'Dipakai oleh','No agent yet':'Belum ada agen',
 'This week':'Minggu ini','Session (5 h)':'Sesi (5 jam)','Online':'Online','Offline':'Offline','Restart agents':'Mulai ulang agen',
 'Plan my week':'Rencanakan mingguku','Dinner ideas':'Ide makan malam','Write a message':'Tulis pesan','Learn something':'Belajar sesuatu',
};
// Sentences with a name inside them (the name sits in its own element, so the pieces are matched apart).
const ID_PATTERNS=[
 [/^Message (.+)… \(type \/ for commands\)$/,'Kirim pesan ke $1… (ketik / untuk perintah)'],
 [/^What should$/,'Mau minta'],[/^work on\? It runs on your AI box, so it keeps going when you close this tab\.$/,'mengerjakan apa? Ia berjalan di server AI-mu, jadi tetap bekerja walau tab ini ditutup.'],
 [/^runs on your AI box and can use its terminal, files and the web\.$/,'berjalan di server AI-mu dan bisa memakai terminal, file, dan web.'],
 [/^What can$/,'Apa yang bisa'],[/^help you with today\?$/,'bantu hari ini?'],[/^can make mistakes\. Check anything important\.$/,'bisa salah. Periksa hal yang penting.'],
 [/^(\d+)% used$/,'$1% terpakai'],[/^Resets in (.+)$/,'Direset dalam $1'],[/^Steer (.+) while it works…$/,'Arahkan $1 saat bekerja…'],
];
const Lang={
 cur:(()=>{try{return localStorage.getItem('aq-lang')||'en'}catch{return 'en'}})(),
 set(l){this.cur=l;try{localStorage.setItem('aq-lang',l)}catch{}document.documentElement.lang=l==='id'?'id':'en';location.reload()},
 t(s){if(this.cur!=='id'||!s)return s;const k=s.trim();const v=ID[k];if(v)return s.replace(k,v);for(const [re,to] of ID_PATTERNS)if(re.test(k))return s.replace(k,k.replace(re,to));return s},
 known(s){const k=(s||'').trim();return !!k&&(k in ID||ID_PATTERNS.some(([re])=>re.test(k)))},
 // the name in words changes; of paths only the two that exist under both names on the box (~/.aqeelos and
 // ~/apps/aqeelos-ui are links), so anything copied from the screen still works
 brand(s){return s.replace(/Hermes Agent/g,'aqeelOS').replace(/Nous Research/g,'aqeelOS').replace(/Hermes/g,'aqeelOS').replace(/\/\.hermes(?=\/|\s|$|['")])/g,'/.aqeelos').replace(/\/apps\/hermes-ui(?=\/|\s|$)/g,'/apps/aqeelos-ui').replace(/(?<![\w./~_])hermes(?![\w/_.])/g,'aqeelos').replace(/\$\{?HERMES_HOME\}?/g,'~/.aqeelos').replace(/\bHERMES_(?=[A-Z])/g,'AQEELOS_')},
 run(root){if(!root)return;const id=this.cur==='id';
  const w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{acceptNode:n=>n.parentElement?.closest('.thread,textarea,[contenteditable],pre,code,.pv-doc,.pv-code,[data-raw]')?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT});
  for(let n;(n=w.nextNode());){const v=n.nodeValue;if(!v||!v.trim())continue;let t=/hermes|nous research/i.test(v)?this.brand(v):v;if(id&&!n.parentElement?.closest('[data-notr],.msg,pre,code,.log,.action-log')&&this.known(t))t=this.t(t);if(t!==v)n.nodeValue=t}
  (root.querySelectorAll?root:document).querySelectorAll('[placeholder],[title],[aria-label]').forEach(e=>{if(e.closest('textarea,[contenteditable]'))return;for(const k of ['placeholder','title','aria-label']){const v=e.getAttribute(k);if(!v)continue;let t=/hermes|nous research/i.test(v)?this.brand(v):v;if(id&&this.known(t))t=this.t(t);if(t!==v)e.setAttribute(k,t)}})},
 start(){if(this.cur==='id')document.documentElement.lang='id';let q=false;
  const todo=new Set();new MutationObserver(ms=>{for(const m of ms)for(const n of m.addedNodes)todo.add(n.nodeType===3?n.parentElement:n);if(q)return;q=true;requestAnimationFrame(()=>{q=false;const l=[...todo];todo.clear();for(const n of l)if(n&&n.isConnected&&n.nodeType===1)this.run(n)})}).observe(document.body,{childList:true,subtree:true,characterData:false});this.run(document.body)},
};
document.addEventListener('DOMContentLoaded',()=>Lang.start());
