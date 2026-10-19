// What you can make: each kind has an icon, a one-line description, a composer placeholder and starter templates.
// The server adds the matching instructions for the AI (outputs.mjs).
const svg=d=>'<svg viewBox="0 0 24 24" aria-hidden="true">'+d+'</svg>';
export const KINDS=[
 {id:'task',name:'Do a task',line:'Browse, collect and sort files. Nothing to build',icon:svg('<path d="M5 12.5l4 4L19 7"/><path d="M4 4h10M4 20h16"/>'),
  placeholder:'Say what to do, for example: save the product photos from this page…',
  templates:[['Save images from a page','Open [website] and save every product image on the page.'],['Collect prices','Go through [website] and collect each product name, price and link into a spreadsheet.'],['Sort my files','Look through the files in [folder] and sort them into folders by what they are.'],['Download documents','Find the PDF brochures on [website] and download them all.']]},
 {id:'app',name:'App or website',line:'Build and preview a working site',icon:svg('<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 9h18M7 6.5h.01M10 6.5h.01"/>'),
  placeholder:'Describe what to build or change…',
  templates:[['Portfolio site','Build a clean portfolio website with a projects section and a contact form.'],['Landing page','Make a one-page landing page for a coffee shop with a menu and opening hours.'],['Explain this project','Explain how this project is structured and how to run it.'],['Fix accessibility','Find and fix accessibility problems on the home page.']]},
 {id:'deck',name:'Slides',line:'A deck you can present or export',icon:svg('<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M12 16v4M8 20h8"/>'),
  placeholder:'Describe your deck: topic, who it is for, roughly how many slides…',
  templates:[['Pitch deck','Make a 10-slide pitch deck for [company] for seed investors: problem, solution, market, traction, business model, team, and the ask.'],['Monthly report','Make an 8-slide monthly report for [team or client]: highlights, key numbers with charts, what worked, what did not, next month.'],['Case study','Make a 6-slide case study: the client, the challenge, what we did, results in numbers, a quote, next steps.'],['Workshop','Make a 12-slide workshop deck teaching [topic] to beginners, with one exercise slide per section.']]},
 {id:'doc',name:'Document',line:'Reports, proposals, PRDs',icon:svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>'),
  placeholder:'Describe the document: what it is, who reads it, what it must cover…',
  templates:[['Proposal','Write a project proposal for [client]: background, goals, scope, timeline, budget, and next steps.'],['PRD','Write a product requirements document for [feature]: problem, users, goals, requirements with acceptance criteria, and open questions.'],['SOP','Write a step-by-step standard operating procedure for [process], with roles and a checklist.'],['Meeting notes','Turn these notes into clean meeting minutes with decisions and action items: [paste notes]']]},
 {id:'design',name:'Design',line:'Screens, social posts, ads',icon:svg('<path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.8-.8 1.8-1.8 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-1 .8-1.8 1.8-1.8H17a4 4 0 0 0 4-4c0-4.4-4-8-9-8z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10.5" cy="7.5" r="1"/><circle cx="15" cy="7.5" r="1"/>'),
  placeholder:'Describe the design: what screens or posts, sizes, the feeling…',
  templates:[['Instagram posts','Design three Instagram posts (1080×1350) announcing [launch], with a bold headline each.'],['App screens','Design the home, detail and checkout screens of a mobile app for [idea] (390×844).'],['Facebook ads','Design three Facebook ad variations (1080×1080) for [product], each testing a different hook.'],['Landing hero','Design three hero section options for [brand] at 1440×900.']]},
 {id:'research',name:'Research report',line:'Searches the web, cites sources',icon:svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5M8 11h6M11 8v6"/>'),
  placeholder:'What should be researched, and what do you need to decide?',
  templates:[['Market scan','Research the market for [product] in [country]: size, main competitors, prices, and gaps.'],['Competitor review','Compare [competitor A], [B] and [C]: offer, pricing, positioning, strengths and weaknesses.'],['Topic brief','Write a briefing on [topic] for a busy executive: what it is, why it matters now, key facts, and what to do.'],['Best practices','Find current best practices for [task] with sources, and turn them into a checklist.']]},
 {id:'data',name:'Data and charts',line:'Analyse a spreadsheet',icon:svg('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
  placeholder:'Attach a CSV or spreadsheet, then say what you want to know…',
  templates:[['Sales dashboard','Analyse the attached sales data and make a dashboard: totals, trend by month, best products, and anything unusual.'],['Ad results','Analyse the attached ad results: spend, cost per result, best and worst campaigns, and what to change.'],['Survey summary','Summarise the attached survey answers with charts per question and the main themes in the comments.'],['Clean up data','Clean the attached spreadsheet (duplicates, empty rows, inconsistent names) and explain what changed.']]},
 {id:'media',name:'Image or video',line:'Through your connected tools',icon:svg('<rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>'),
  placeholder:'Describe the image or video: subject, style, size…',
  templates:[['Product shots','Make four product photos of [product] on clean backgrounds, square format.'],['Social video','Make a 10-second vertical video showing [product] in use.'],['Hero image','Make a wide hero image for [brand] website: [mood].'],['Variations','Make three variations of this image in different styles: [describe]']]},
];
export const kind=id=>KINDS.find(k=>k.id===id)||KINDS[0];
