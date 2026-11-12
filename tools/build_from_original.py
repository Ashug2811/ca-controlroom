"""One-time converter: takes the original single-file CA Daily Desk and produces
index.html for the web app. Every original tool is kept unchanged; this only
adds login, cloud sync, new tabs and fixes that are needed outside the
original viewer. Run: python3 tools/build_from_original.py original.html index.html tools/sections.html
"""
import sys, re

src = open(sys.argv[1], encoding='utf-8').read()
out = src

def sub1(old, new):
    global out
    n = out.count(old)
    if n != 1:
        raise SystemExit(f'expected exactly one match, found {n}: {old[:80]!r}')
    out = out.replace(old, new)

# 1. Head: app styles + our scripts (loaded before the body so the login gate can appear first).
sub1('<title>CA Daily Desk | M/s. Malaji And Co</title>',
     '<title>CA Daily Desk | M/s. Malaji And Co</title>\n'
     '<link rel="manifest" href="manifest.webmanifest"><meta name="theme-color" content="#1546a0">\n'
     '<link rel="icon" href="icon.svg" type="image/svg+xml">\n'
     '<link rel="stylesheet" href="css/app.css">')

# 2. Header: who is logged in, sync status, sign out.
sub1('<div class="row no-print"><button class="btn ghost small" id="th-btn">',
     '<div class="row no-print"><span id="who" class="who"></span><span id="sync" class="sync" hidden></span>'
     '<button class="btn ghost small" id="so-btn" hidden>Sign out</button><button class="btn ghost small" id="th-btn">')

# 3. Nav: new tabs.
sub1('<button role="tab" data-tab="tracker" aria-selected="false">Compliance tracker</button>',
     '<button role="tab" data-tab="tracker" aria-selected="false">Compliance tracker</button>\n'
     '  <button role="tab" data-tab="calendar" aria-selected="false">Due-date calendar</button>')
sub1('<button role="tab" data-tab="backup" aria-selected="false">Backup</button>',
     '<button role="tab" data-tab="billing" aria-selected="false">Billing</button>\n'
     '  <button role="tab" data-tab="work" aria-selected="false">Time and work</button>\n'
     '  <button role="tab" data-tab="inbox" aria-selected="false">Document inbox</button>\n'
     '  <button role="tab" data-tab="team" aria-selected="false">Team</button>\n'
     '  <button role="tab" data-tab="backup" aria-selected="false">Backup</button>')

# 4. Client master: add email + address so reminders can go by email too.
sub1('<label class="fld">Mobile<input id="cm-ph" style="width:130px"></label>',
     '<label class="fld">Mobile<input id="cm-ph" style="width:130px"></label>'
     '<label class="fld">Email<input id="cm-em" type="email" style="width:190px"></label>')
sub1("CM.push({n,g,p:pn,ph:val('cm-ph').trim()});sdb('ca.cm',CM);['cm-n','cm-g','cm-p','cm-ph']",
     "CM.push({n,g,p:pn,ph:val('cm-ph').trim(),em:val('cm-em').trim()});sdb('ca.cm',CM);['cm-n','cm-g','cm-p','cm-ph','cm-em']")
sub1('<th>Mobile</th><th></th></tr></thead>', '<th>Mobile</th><th>Email</th><th></th></tr></thead>')
sub1("<td>${esc(c.ph)}</td><td style=\"white-space:nowrap\"><button class=\"btn small\" data-u",
     "<td>${esc(c.ph)}</td><td>${esc(c.em||'')}</td><td style=\"white-space:nowrap\"><button class=\"btn small\" data-u")
sub1("'<tr><td colspan=\"5\">No clients yet.</td></tr>'", "'<tr><td colspan=\"6\">No clients yet.</td></tr>'")

# 5. Wording: data is no longer only in this browser.
sub1('Everything is kept in this browser only: clients, assignments, tracker and bank rules. Save a backup file regularly, and restore it on another device.',
     'Your data is saved online for the whole firm and every save is kept for 90 days. A backup file is still useful as an extra copy. To bring data over from the old single-file tool, save a backup there and restore it here.')
sub1('Clients and ticks are stored in this browser only. Save a backup file to move them to another device.',
     'Clients and ticks are saved online for the whole team.')
sub1('Changes are stored in this browser and included in the backup.',
     'Changes are saved for the whole firm and included in the backup.')

# 6. New tab sections, before the closing of the main wrap.
sub1('</div>\n<div id="toast" hidden></div>',
     '<!--#new-sections-->\n</div>\n<div id="toast" hidden></div>\n<div id="gate" class="gate" hidden></div>\n<div id="live" class="live" hidden></div>')

# 7. Use the bundled spreadsheet library (works even when a CDN is blocked).
sub1('<script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>',
     '<script src="lib/xlsx.full.min.js"></script>\n<script src="lib/supabase.js"></script>\n'
     '<script src="config.js"></script>\n<script src="js/extras.js"></script>\n<script src="js/calendar.js"></script>\n'
     '<script src="js/store.js"></script>\n<script src="js/team.js"></script>\n<script src="js/billing.js"></script>\n<script src="js/work.js"></script>\n<script src="js/inbox.js"></script>\n<script src="js/gst-plus.js"></script>\n<script src="js/bank-plus.js"></script>\n<script src="js/tabs.js"></script>\n<script src="js/cloud.js"></script>')

# 8. The original script now runs after login (cloud.js starts it).
sub1('<script>\n//#logic-start', '<script type="text/plain" id="app-src">\n//#logic-start')

# 9. File saving: the original relied on the Claude viewer. Fall back to a normal download.
sub1("  if(!dl){toast('Saving files is not available in this view. Use Copy instead.');return;}",
     "  if(!dl){try{const b=data instanceof Blob?data:new Blob([data],{type:/\\.json$/.test(name)?'application/json':/\\.xml$/.test(name)?'application/xml':'application/octet-stream'});"
     "const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=name;document.body.appendChild(a);a.click();"
     "setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},1500);toast('Saved '+name);}catch(e){toast('Could not save: '+e.message);}return;}")

# 10. Tabs: allow the new tabs and let other modules hook in when a tab opens.
sub1("const TABS=['home','gst','bank','tracker','tax','more','clients','assign','settings','backup'];",
     "const TABS=['home','gst','bank','tracker','calendar','tax','more','clients','assign','billing','work','inbox','settings','team','backup','gsttools','books','taxtools'];")
sub1("  if(t==='home'&&window.dhRun)dhRun();\n}",
     "  if(t==='home'&&window.dhRun)dhRun();\n  if(window.onTabShown)window.onTabShown(t);\n}")

# 11. Expose a few app internals to the add-on modules.
sub1("showTab(location.hash.slice(1));\n</script>",
     "window.APP={get COMPS(){return COMPS},get TR(){return TR},get CM(){return CM},get AS(){return AS},saveTR,trRender,trCheckboxes,cmRun,asRun,dhRun,showTab,toast,esc,inr,inr0,fmtD,parseDate,daysBetween,today0,taskStatus,saveFile};\n"
     "if(window.afterAppStart)window.afterAppStart();\n"
     "showTab(location.hash.slice(1));\n</script>")

out = out.replace('<!--#new-sections-->', open(sys.argv[3], encoding='utf-8').read())
out = out.replace('CA Daily Desk', 'CA ControlRoom').replace('ca-daily-desk', 'ca-controlroom')  # product renamed 2026-11-12
# Tabs that do the same kind of work are merged into 9 groups (2026-11-12); js/tabs.js adds the sub-tabs.
import re as _re
out = _re.sub(r'(<nav class="tabs" role="tablist" aria-label="Tools">).*?(</nav>)', lambda m: m.group(1) + '''
  <button role="tab" data-tab="home" aria-selected="true">Home</button>
  <button role="tab" data-tab="gst" aria-selected="false">GST</button>
  <button role="tab" data-tab="bank" aria-selected="false">Bank and books</button>
  <button role="tab" data-tab="tax" aria-selected="false">Tax and TDS</button>
  <button role="tab" data-tab="tracker" aria-selected="false">Compliance</button>
  <button role="tab" data-tab="clients" aria-selected="false">Clients</button>
  <button role="tab" data-tab="assign" aria-selected="false">Fees and billing</button>
  <button role="tab" data-tab="work" aria-selected="false">Time and work</button>
  <button role="tab" data-tab="settings" aria-selected="false">Settings</button>
''' + m.group(2), out, count=1, flags=_re.S)
# Firm name removed from the app header and browser tab (2026-11-12); it stays on invoices, receipts and printouts.
out = out.replace('<title>CA ControlRoom | M/s. Malaji And Co</title>', '<title>CA ControlRoom</title>')
out = out.replace('<div><p class="brand"><span class="logo">M</span>M/s. Malaji And Co</p><h1>CA ControlRoom</h1></div>', '<div><h1>CA ControlRoom</h1></div>')
open(sys.argv[2], 'w', encoding='utf-8').write(out)
print('ok', len(out))
