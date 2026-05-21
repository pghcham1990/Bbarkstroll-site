/* === Content Calendar View ===
   A year-round library of Facebook-group posts (caption + matching Midjourney
   prompt) plus a tool to overlay the Bark & Stroll logo/headline onto MJ art.
   All rendered content comes from the static constants in this file and is
   escaped via esc(); user-entered branding text is sent to the server and is
   never injected into the DOM as HTML. */

const CONTENT_TAGS = {
  awareness:  { emoji: '🐾', label: 'Awareness' },
  hiring:     { emoji: '💼', label: 'Hiring' },
  seasonal:   { emoji: '🎉', label: 'Seasonal' },
  engagement: { emoji: '💬', label: 'Engagement' },
};

// Shared Midjourney style anchor so every image matches the brand.
const MJ_STYLE = 'warm natural golden-hour light, candid photographic style, shallow depth of field, forest green and warm gold color palette, cozy Pittsburgh suburb feel, wholesome and trustworthy --ar 4:5 --style raw';

function mj(subject) { return subject + ', ' + MJ_STYLE; }

const CONTENT_MONTHS = [
  { month: 'January', theme: 'New Year, fresh routines, deep winter', posts: [
    { tag: 'awareness', occasion: 'New Year routine', caption: `New year, same wagging tail. If 2026 is the year you get your time back, let us handle the midday walks. Bridgeville Bark & Stroll covers your dog while you are at work, at the gym, or just need a break. Booking now at barkstroll.com.`, mj: mj('a happy golden retriever on a snowy suburban sidewalk in winter morning light, leash in frame, breath visible in cold air') },
    { tag: 'engagement', occasion: 'Question post', caption: `Settle a debate for us. What is your dog's favorite winter activity? Snow zoomies, window watching, or burrowing under every blanket in the house? Drop a photo in the comments, we want to see.`, mj: mj('a small dog joyfully leaping through fresh snow in a backyard, snow flying, pure joy') },
    { tag: 'hiring', occasion: 'New year hiring', caption: `Looking for flexible work in 2026 that does not feel like work? We are adding dog walkers in the Bridgeville and South Hills area. Set your own availability, get paid per walk, spend your day outside with good dogs. Background check required. Message us to learn more.`, mj: mj('a friendly dog walker in a green jacket walking two leashed dogs down a tree-lined suburban street, smiling') },
    { tag: 'seasonal', occasion: 'Winter paw safety', caption: `Quick winter reminder: road salt is rough on paws. Wipe those feet after every walk, and watch for limping or licking. We do a paw check on every single visit, because the little things matter. Stay warm out there.`, mj: mj('close up of a dogs paws being gently wiped with a towel by the front door, soft indoor winter light') },
  ]},
  { month: 'February', theme: "Valentine's, love your dog, midwinter", posts: [
    { tag: 'seasonal', occasion: "Valentine's Day", caption: `Roses are red, this pup is the best. Happy Valentine's Day from Bridgeville Bark & Stroll. Tag the dog who has your whole heart. We will start: every single one on our route.`, mj: mj('an adorable dog wearing a small red bandana sitting beside a few red roses, soft warm light, charming') },
    { tag: 'awareness', occasion: 'Why us', caption: `Not a faceless app. Not a stranger every time. When you book with Bridgeville Bark & Stroll, you get a consistent, trusted local team and one point of contact who knows your dog by name. That is the difference. See for yourself at barkstroll.com.`, mj: mj('a dog walker kneeling to greet a happy dog at a front door, genuine connection, warm afternoon light') },
    { tag: 'engagement', occasion: 'Fill in the blank', caption: `Fill in the blank: My dog's most dramatic behavior is ______. Winner gets bragging rights and our undivided attention in the comments.`, mj: mj('a comically dramatic looking dog flopped over on a couch, expressive face, cozy living room') },
    { tag: 'hiring', occasion: 'Reliable walker ask', caption: `Know someone reliable, kind, and great with dogs? We are hiring walkers in the South Hills. Send them our way. A good word from a neighbor means more than any job board. Comment or message to connect.`, mj: mj('a cheerful person in winter clothing holding a leash with a calm dog in a snowy neighborhood park') },
  ]},
  { month: 'March', theme: "Early spring, mud season, St. Patrick's", posts: [
    { tag: 'seasonal', occasion: "St. Patrick's Day", caption: `Lucky to walk the best dogs in Bridgeville. Happy St. Patrick's Day from our crew to your pack. May your yard be green and your dog only mildly muddy.`, mj: mj('a happy dog wearing a small green bow trotting across a fresh green lawn in spring sunshine') },
    { tag: 'awareness', occasion: 'Mud season', caption: `Mud season is upon us. We towel off paws and bellies before we bring your pup back inside, every visit, no extra charge. Your floors can relax. Book your spring walks at barkstroll.com.`, mj: mj('a muddy pawed happy dog being toweled off on a back porch in early spring, playful mood') },
    { tag: 'engagement', occasion: 'Spring poll', caption: `Spring is almost here. What does your dog love most about the warmer months? More walks, backyard naps in the sun, or chasing every squirrel that dares show its face? Tell us below.`, mj: mj('a content dog lying in a warm patch of spring sunlight on a wooden deck, eyes half closed') },
    { tag: 'hiring', occasion: 'Spring growth', caption: `Spring is our busy season and we are growing. If you love dogs and want flexible paid work outdoors around Bridgeville, we want to meet you. Set your hours, walk great dogs, get paid per visit. Message us to apply.`, mj: mj('a smiling dog walker with two leashes walking through a blooming early spring neighborhood') },
  ]},
  { month: 'April', theme: 'Spring in full, Easter, allergies, longer days', posts: [
    { tag: 'seasonal', occasion: 'Easter / spring', caption: `Hoppy spring from Bridgeville Bark & Stroll. Reminder this weekend: chocolate, xylitol, and that basket grass are not dog friendly. Keep them up high, and let your pup hunt for their own treats on a good long walk instead.`, mj: mj('a sweet dog sniffing among spring tulips and daffodils in a sunny garden, pastel spring colors') },
    { tag: 'awareness', occasion: 'Longer days', caption: `The days are getting longer and your dog has noticed. More daylight means more walks, and we have the schedule to match. Midday, evening, weekends, we flex around your life. Lock in your spring spots at barkstroll.com.`, mj: mj('a dog and walker silhouetted in long golden evening light on a suburban path, warm and inviting') },
    { tag: 'engagement', occasion: 'Throwback', caption: `Show us a throwback. Post your dog as a puppy versus now. We are obsessed with a good glow up. Bonus points if the same toy made it into both photos.`, mj: mj('a side by side feeling image of a puppy and the same dog grown up, heartwarming, soft light') },
    { tag: 'hiring', occasion: 'Outdoor job', caption: `Tired of being stuck inside all day? Our walkers spend spring afternoons outside with happy dogs and get paid for it. Flexible hours around Bridgeville and the South Hills. Background check required. Comment or message to start.`, mj: mj('a dog walker enjoying a sunny spring walk with a leashed dog, fresh green trees, relaxed and happy') },
  ]},
  { month: 'May', theme: "Mother's Day, Memorial Day, warm weather kicks in", posts: [
    { tag: 'seasonal', occasion: "Mother's Day", caption: `To all the dog moms out there, today is for you too. Happy Mother's Day from Bridgeville Bark & Stroll. Tag a dog mom who deserves a little extra love this weekend.`, mj: mj('a woman laughing as her dog gives her a gentle nuzzle in a sunny backyard, joyful mothers day mood') },
    { tag: 'seasonal', occasion: 'Memorial Day travel', caption: `Heading away for the long weekend? Do not stress about your pup. We do drop in visits, walks, and feedings so your dog stays home, comfortable, and on schedule while you travel. Spots fill fast for holidays, book early at barkstroll.com.`, mj: mj('a relaxed dog resting by a window at home in warm light, peaceful and content, owner away') },
    { tag: 'awareness', occasion: 'Heat reminder', caption: `Friendly heads up as it warms up: pavement can burn paws even when the air feels fine. Press the back of your hand to the sidewalk for seven seconds. Too hot for you, too hot for them. We walk early, shaded, and smart.`, mj: mj('a dog walking on a shaded grassy path away from hot pavement on a bright warm day, dappled light') },
    { tag: 'hiring', occasion: 'Summer crew', caption: `Building our summer walking crew now. If you want flexible, paid, outdoor work around Bridgeville this summer, this is your sign. Set your own availability, walk wonderful dogs, get paid per walk. Message us to apply.`, mj: mj('a smiling young dog walker with a leashed dog on a sunny early summer street, warm and energetic') },
  ]},
  { month: 'June', theme: 'Summer begins, heat safety, vacation coverage', posts: [
    { tag: 'awareness', occasion: 'Vacation season', caption: `Summer travel season is here. Before you book the trip, book the dog care. We keep your pup home and happy with walks, feedings, and check ins while you are away. No kennels, no stress. Reserve your dates at barkstroll.com.`, mj: mj('a happy dog greeting a dog sitter at the front door with a wagging tail, summer afternoon light') },
    { tag: 'seasonal', occasion: 'Hydration', caption: `Hot one today. Every summer visit, we make sure water bowls are full and fresh before we leave. Hydration is not optional. How does your dog beat the heat? Show us their favorite cool down spot.`, mj: mj('a dog lapping water from a fresh bowl in a shaded backyard on a hot summer day, refreshing mood') },
    { tag: 'engagement', occasion: 'Caption this', caption: `Caption this. Best one wins our official seal of approval and probably ruins our productivity for the afternoon. Go.`, mj: mj('a goofy dog mid sneeze or yawn with a hilarious expression, bright outdoor summer setting') },
    { tag: 'hiring', occasion: 'Now hiring summer', caption: `Now hiring dog walkers for the summer in Bridgeville and the South Hills. Outdoor work, flexible hours, paid per walk, and the best coworkers on four legs. Background check required. Comment or message and we will tell you more.`, mj: mj('two dog walkers laughing together while walking several happy dogs on a sunny suburban street') },
  ]},
  { month: 'July', theme: 'July 4th fireworks anxiety, peak heat, vacations', posts: [
    { tag: 'seasonal', occasion: 'July 4th fireworks', caption: `Fireworks are tough on a lot of dogs. Tonight, give them a quiet room, close the blinds, turn on some background noise, and tire them out with a good walk earlier in the day. We are happy to handle that pre fireworks walk so they sleep through the booms. Stay safe out there.`, mj: mj('a calm dog resting safely in a cozy quiet room with soft lamp light, comforting and secure mood') },
    { tag: 'awareness', occasion: 'Peak heat walks', caption: `Heat advisory means we shift gears: early morning and later evening walks, shaded routes, lots of water, and shorter loops when it is brutal. Your dog's safety sets the schedule, not the clock. Book heat smart summer walks at barkstroll.com.`, mj: mj('a dog and walker on an early morning summer walk with soft low sun and long shadows, calm and cool') },
    { tag: 'engagement', occasion: 'Summer poll', caption: `Summer poll. Is your dog a beach and water lover or a stay in the air conditioning kind of dog? No wrong answers, but we are keeping score in the comments.`, mj: mj('a happy dog splashing in a kiddie pool in a backyard, water droplets, joyful summer fun') },
    { tag: 'hiring', occasion: 'Mid summer hiring', caption: `Still hiring. Our summer is busy and good walkers are gold. If you are dependable, kind, and love being around dogs, we want to talk. Flexible hours around Bridgeville, paid per walk. Message us to get started.`, mj: mj('a friendly dog walker giving a water break to a dog under a shady tree on a summer afternoon') },
  ]},
  { month: 'August', theme: 'Back to school, busy families, late summer', posts: [
    { tag: 'awareness', occasion: 'Back to school', caption: `Back to school means back to long, busy days, and your dog feels the shift too. Let us break up their afternoon with a walk and some company while the house is empty. Routine keeps them calm. Set up your school year schedule at barkstroll.com.`, mj: mj('a lonely looking dog waiting by a window in an empty house during the day, then a walker arriving, warm light') },
    { tag: 'seasonal', occasion: 'Late summer', caption: `Soaking up the last long evenings of summer with our favorite clients. The light this time of year is unmatched and so are these dogs. Drop your golden hour dog photos below, we will go first.`, mj: mj('a dog and owner walking into warm golden late summer sunset light, long shadows, nostalgic feeling') },
    { tag: 'engagement', occasion: 'Name game', caption: `Tell us your dog's name and the absurd nickname you actually call them. We will start the comments and we are not embarrassed about it.`, mj: mj('a sweet expressive dog tilting its head as if listening to its name, charming close up, soft light') },
    { tag: 'hiring', occasion: 'School year flexibility', caption: `Students and flexible schedules, this one is for you. We are hiring dog walkers around Bridgeville for the school year. Pick your hours, walk great dogs between classes or shifts, get paid per walk. Background check required. Message us to apply.`, mj: mj('a young dog walker with a backpack walking a happy dog through a late summer neighborhood') },
  ]},
  { month: 'September', theme: 'Fall begins, back to routine, Labor Day', posts: [
    { tag: 'seasonal', occasion: 'First crisp days', caption: `First crisp morning of the season and the dogs are LIVING for it. Cool air, crunchy leaves, extra pep in every step. Fall walks hit different. Book yours at barkstroll.com.`, mj: mj('an energetic dog trotting through early fall leaves on a crisp morning walk, golden and orange tones') },
    { tag: 'awareness', occasion: 'Routine reset', caption: `Fall is the perfect time to reset your dog's routine. Consistent walks mean a calmer, happier, better behaved pup, and a lot less guilt on your long work days. We make it easy. Reserve a regular weekly spot at barkstroll.com.`, mj: mj('a calm well exercised dog resting happily at home after a walk, autumn light through the window') },
    { tag: 'engagement', occasion: 'Fall favorites', caption: `Settle it for us. Does your dog love or hate the leaf piles? Diving in headfirst or refusing to step on a single crunchy one? We need to know.`, mj: mj('a playful dog jumping into a big pile of autumn leaves, leaves flying everywhere, pure joy') },
    { tag: 'hiring', occasion: 'Fall crew', caption: `Beautiful season to be a dog walker. We are adding to our Bridgeville crew this fall. Outdoor work, flexible hours, paid per walk, leaves included. Background check required. Comment or message to learn more.`, mj: mj('a content dog walker strolling with a dog through a colorful autumn tree lined street') },
  ]},
  { month: 'October', theme: 'Halloween, fall foliage, cooler days', posts: [
    { tag: 'seasonal', occasion: 'Halloween safety', caption: `Spooky season safety check. Keep the candy out of reach, chocolate and xylitol are no good, and the doorbell chaos stresses a lot of dogs out. A long walk before trick or treaters arrive helps them settle. We are happy to handle it. Happy Halloween from our pack to yours.`, mj: mj('a cute dog wearing a simple charming halloween bandana beside a small pumpkin, cozy autumn porch') },
    { tag: 'awareness', occasion: 'Foliage walks', caption: `Peak foliage and peak walk weather. There is no better month to be outside with your dog around the South Hills. If your schedule does not allow it, we will give them the fall walk they deserve. Book at barkstroll.com.`, mj: mj('a dog and walker on a path surrounded by vibrant red and orange fall foliage, breathtaking autumn color') },
    { tag: 'engagement', occasion: 'Costume contest', caption: `Unofficial costume contest, comments edition. Post your dog's Halloween look, past or present. The more reluctant the dog looks about it, the better. Winner gets eternal glory.`, mj: mj('a good natured dog in a simple cute halloween costume looking adorably unimpressed, warm indoor light') },
    { tag: 'hiring', occasion: 'Cozy season hiring', caption: `Cozy season is the best season to walk dogs. We are hiring in Bridgeville and the South Hills. Flexible hours, paid per walk, crunchy leaves on the house. Background check required. Message us to apply.`, mj: mj('a happy dog walker in a warm sweater walking a dog through an autumn neighborhood at golden hour') },
  ]},
  { month: 'November', theme: 'Thanksgiving travel, gratitude, cooler weather', posts: [
    { tag: 'seasonal', occasion: 'Thanksgiving travel', caption: `Traveling for Thanksgiving? Keep your dog home and on routine with our drop in visits, walks, and feedings. Holiday spots go fast, so lock in your dates now at barkstroll.com. No kennels, no stress, just a familiar face checking in.`, mj: mj('a peaceful dog resting comfortably at home near a window with soft november light, cozy and safe') },
    { tag: 'seasonal', occasion: 'Thanksgiving safety', caption: `Thanksgiving table reminder: turkey bones, onions, and rich leftovers are not dog safe. Give them their own little treat and a good walk instead. We are grateful for every dog and family we get to serve this year. Happy Thanksgiving.`, mj: mj('a sweet dog sitting politely near a cozy autumn dinner setting, warm candlelight, wholesome scene') },
    { tag: 'awareness', occasion: 'Gratitude post', caption: `This year we are thankful for the trust of our Bridgeville neighbors, the wagging tails that greet us every day, and the chance to do work we genuinely love. Thank you for letting us be part of your dog's day. More walks ahead at barkstroll.com.`, mj: mj('a heartfelt moment of a dog leaning into a walker with trust and affection, warm grateful mood') },
    { tag: 'hiring', occasion: 'Holiday coverage hiring', caption: `The holidays are our busiest stretch and we need dependable walkers and sitters around Bridgeville. Flexible hours, paid per visit, great dogs. Perfect for extra holiday income. Background check required. Message us to get started.`, mj: mj('a friendly dog sitter arriving at a home to care for a happy dog, late autumn afternoon light') },
  ]},
  { month: 'December', theme: 'Holidays, travel, gift of time, winter safety', posts: [
    { tag: 'seasonal', occasion: 'Holiday travel', caption: `Holiday travel plans? Your dog does not have to come along or go to a kennel. We keep them home, warm, walked, and fed on schedule while you are away. December books up fast, reserve your dates now at barkstroll.com.`, mj: mj('a content dog curled up at home near holiday decor and soft warm lights, peaceful and cozy winter scene') },
    { tag: 'awareness', occasion: 'Gift of time', caption: `The best gift this season is time, and we give it back to you. While you handle the shopping, the cooking, and the chaos, we will handle the walks. Treat yourself to one less thing to worry about. Book at barkstroll.com.`, mj: mj('a stressed but smiling person handing off a leash to a calm dog walker at the door during the holidays') },
    { tag: 'engagement', occasion: 'Holiday photos', caption: `Show us the holiday dog photos. Festive bandanas, reluctant antlers, staring longingly at the tree, we want all of it. We will get the comments started.`, mj: mj('an adorable dog beside a decorated holiday tree with soft twinkling lights, festive and warm') },
    { tag: 'seasonal', occasion: 'Winter walk safety', caption: `Cold weather walking tips from our crew: keep walks a bit shorter in deep cold, wipe paws after salt, and watch for shivering or lifted paws. We bundle up and brave it so you do not have to. Stay warm and book winter walks at barkstroll.com.`, mj: mj('a dog walker bundled in winter gear walking a happy dog through a light snowfall on a quiet street') },
  ]},
];

const EVERGREEN_POSTS = [
  { tag: 'awareness', occasion: 'Service explainer', caption: `New here? Bridgeville Bark & Stroll offers dog walking, drop in visits, pet sitting, and feedings across Bridgeville and the South Hills. One trusted local team, one point of contact, every visit on schedule. Learn more and book at barkstroll.com.`, mj: mj('a professional friendly dog walker with a happy leashed dog in front of a welcoming suburban home') },
  { tag: 'awareness', occasion: 'Referral ask', caption: `The best compliment you can give us is a referral. If your dog loves their walks, tell a neighbor. Word of mouth is how small local businesses like ours grow, and we are grateful for every one. Tag a friend whose dog needs us.`, mj: mj('two neighbors chatting while their dogs greet each other happily on a friendly suburban street') },
  { tag: 'engagement', occasion: 'Review request', caption: `If we have walked your pup, we would love a quick review. It takes two minutes and it helps other local dog families find us. Drop a comment or leave one on our page. Thank you for trusting us with your best friend.`, mj: mj('a joyful dog looking up at the camera with a big happy expression, bright cheerful background') },
  { tag: 'hiring', occasion: 'Evergreen hiring', caption: `Always looking for great dog walkers around Bridgeville and the South Hills. Flexible hours, paid per walk, outdoor work, and the best four legged coworkers around. Background check required. Comment or message us to apply anytime.`, mj: mj('a smiling dog walker holding multiple leashes with calm happy dogs, sunny suburban park setting') },
  { tag: 'awareness', occasion: 'Trust and safety', caption: `Your dog's safety is the whole job. Every walker is background checked, every visit is logged, and you always have one point of contact who knows your dog. That is why Bridgeville families trust us. Book with confidence at barkstroll.com.`, mj: mj('a trustworthy dog walker carefully securing a harness on a calm dog by the front door, reassuring mood') },
  { tag: 'engagement', occasion: 'Meet the dogs', caption: `Behind every great day is a great dog. Meet one of the regulars on our route. Want your pup featured? Comment with their name and best angle. We love showing off our clients.`, mj: mj('a charming portrait of a happy dog mid walk looking back at the camera, warm golden light, personable') },
];

function copyBtn(text) {
  const enc = encodeURIComponent(text);
  return '<button class="copy-btn" data-copy="' + enc + '">Copy</button>';
}

function postCardHTML(p) {
  const t = CONTENT_TAGS[p.tag];
  return ''
    + '<div class="post-card" data-tag="' + p.tag + '">'
    + '  <div class="post-head">'
    + '    <span class="post-tag tag-' + p.tag + '">' + t.emoji + ' ' + t.label + '</span>'
    + '    <span class="post-occasion">' + esc(p.occasion) + '</span>'
    + '  </div>'
    + '  <div class="post-block">'
    + '    <div class="post-block-label">Caption ' + copyBtn(p.caption) + '</div>'
    + '    <div class="post-caption">' + esc(p.caption) + '</div>'
    + '  </div>'
    + '  <div class="post-block">'
    + '    <div class="post-block-label">Midjourney prompt ' + copyBtn(p.mj) + '</div>'
    + '    <div class="post-mj">' + esc(p.mj) + '</div>'
    + '  </div>'
    + '</div>';
}

async function render_content(el) {
  const filterChips = Object.entries(CONTENT_TAGS)
    .map(function (e) { return '<button class="filter-chip" data-filter="' + e[0] + '">' + e[1].emoji + ' ' + e[1].label + '</button>'; })
    .join('');

  const monthsHTML = CONTENT_MONTHS.map(function (m, i) {
    return ''
      + '<div class="content-month">'
      + '  <button class="content-month-head" data-month="' + i + '">'
      + '    <span><span class="cm-name">' + esc(m.month) + '</span><span class="cm-theme">' + esc(m.theme) + '</span></span>'
      + '    <span class="cm-chevron">&#9656;</span>'
      + '  </button>'
      + '  <div class="content-month-body" id="cm-' + i + '" style="display:none;">'
      +      m.posts.map(postCardHTML).join('')
      + '  </div>'
      + '</div>';
  }).join('');

  const markup = ''
    + '<p class="section-label">Marketing</p>'
    + '<h1 class="section-title">Content Calendar</h1>'
    + '<p style="color:var(--text-soft);font-size:13px;line-height:1.55;margin-bottom:18px;max-width:640px;">'
    + 'A year of ready-to-post content for Facebook groups. Each post has a copy-ready caption and a matching '
    + 'Midjourney image prompt. Generate the art in Midjourney, brand it with the tool below, then post. '
    + 'Two goals baked in: more clients (awareness) and more walkers (hiring).</p>'

    + '<div class="glass-panel" style="margin-bottom:22px;">'
    + '  <div class="glass-panel-header"><h3 class="glass-panel-title">&#127912; Brand a Midjourney image</h3></div>'
    + '  <div class="glass-panel-body">'
    + '    <p style="color:var(--text-soft);font-size:13px;line-height:1.5;margin-bottom:14px;">'
    + '      Upload your Midjourney art and we will overlay the Bark &amp; Stroll logo, name, and website along the '
    + '      bottom. Add an optional headline (like "Now Booking Summer Walks") to turn it into a promo graphic.</p>'
    + '    <form id="brandForm">'
    + '      <label for="brandFile" class="gallery-dropzone" id="brandDrop">'
    + '        <input type="file" id="brandFile" accept="image/*" hidden required>'
    + '        <div class="gallery-dropzone-inner">'
    + '          <div class="gallery-dropzone-title" id="brandDropTitle">Tap to choose your Midjourney image</div>'
    + '          <div class="gallery-dropzone-hint">JPEG, PNG, WebP or HEIC, up to 20MB</div>'
    + '        </div>'
    + '      </label>'
    + '      <div class="gallery-fields" style="margin-top:14px;">'
    + '        <div class="form-group"><label for="brandHeadline">Headline <span style="color:var(--text-soft);font-weight:400;">(optional)</span></label>'
    + '          <input type="text" id="brandHeadline" maxlength="80" placeholder="e.g. Now Booking Summer Walks"></div>'
    + '        <div class="form-group"><label for="brandSub">Subtext <span style="color:var(--text-soft);font-weight:400;">(optional)</span></label>'
    + '          <input type="text" id="brandSub" maxlength="90" placeholder="e.g. Bridgeville & the South Hills"></div>'
    + '      </div>'
    + '      <div class="gallery-upload-actions">'
    + '        <button type="submit" class="btn btn-primary" id="brandBtn" disabled>Brand it</button>'
    + '        <div id="brandStatus" class="gallery-status" aria-live="polite"></div>'
    + '      </div>'
    + '    </form>'
    + '    <div id="brandPreviewWrap" style="display:none;margin-top:16px;">'
    + '      <img id="brandPreview" alt="Branded preview" style="max-width:100%;max-height:420px;border-radius:12px;border:1px solid rgba(20,97,58,.15);">'
    + '      <div style="margin-top:10px;"><a id="brandDownload" class="btn btn-primary btn-sm" download="barkstroll-branded.png">Download branded image</a></div>'
    + '    </div>'
    + '  </div>'
    + '</div>'

    + '<div class="content-filter" id="contentFilter">'
    + '  <button class="filter-chip active" data-filter="all">All</button>'
    +    filterChips
    + '</div>'

    + '<div class="content-month">'
    + '  <button class="content-month-head" data-month="evergreen">'
    + '    <span><span class="cm-name">Anytime / Evergreen</span><span class="cm-theme">Post these in any month</span></span>'
    + '    <span class="cm-chevron">&#9656;</span>'
    + '  </button>'
    + '  <div class="content-month-body" id="cm-evergreen" style="display:none;">'
    +      EVERGREEN_POSTS.map(postCardHTML).join('')
    + '  </div>'
    + '</div>'
    + monthsHTML
    + '<style>'
    + '.content-filter{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;}'
    + '.filter-chip{font-size:.74rem;font-weight:600;padding:6px 14px;border-radius:20px;border:1px solid rgba(20,97,58,.2);background:#fff;color:var(--text-soft);cursor:pointer;font-family:inherit;}'
    + '.filter-chip.active{background:var(--forest);color:#fff;border-color:var(--forest);}'
    + '.content-month{border:1px solid rgba(20,97,58,.12);border-radius:12px;margin-bottom:10px;overflow:hidden;background:#fff;}'
    + '.content-month-head{width:100%;display:flex;align-items:center;justify-content:space-between;padding:14px 16px;background:none;border:none;cursor:pointer;text-align:left;font-family:inherit;}'
    + '.content-month-head:hover{background:rgba(20,97,58,.03);}'
    + ".cm-name{display:block;font-weight:700;font-size:1rem;color:var(--forest);font-family:'DM Serif Display',Georgia,serif;}"
    + '.cm-theme{display:block;font-size:.72rem;color:var(--text-soft);margin-top:2px;}'
    + '.cm-chevron{color:var(--forest);font-size:1rem;transition:transform .2s;}'
    + '.content-month.open .cm-chevron{transform:rotate(90deg);}'
    + '.content-month-body{padding:4px 16px 16px;display:flex;flex-direction:column;gap:12px;}'
    + '.post-card{border:1px solid rgba(20,97,58,.1);border-radius:10px;padding:14px;background:var(--cream,#faf8f4);}'
    + '.post-card.hidden{display:none;}'
    + '.post-head{display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap;}'
    + '.post-tag{font-size:.66rem;font-weight:700;padding:3px 9px;border-radius:20px;}'
    + '.tag-awareness{background:rgba(46,160,90,.14);color:#1f8a4c;}'
    + '.tag-hiring{background:rgba(52,152,219,.14);color:#2b7fb8;}'
    + '.tag-seasonal{background:rgba(196,164,78,.18);color:#a8852f;}'
    + '.tag-engagement{background:rgba(155,89,182,.14);color:#8e44ad;}'
    + '.post-occasion{font-size:.74rem;color:var(--text-soft);font-weight:600;}'
    + '.post-block{margin-top:8px;}'
    + '.post-block-label{font-size:.62rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--text-soft);margin-bottom:4px;display:flex;align-items:center;gap:8px;}'
    + '.copy-btn{font-size:.6rem;font-weight:700;padding:2px 9px;border-radius:14px;border:1px solid var(--forest);background:#fff;color:var(--forest);cursor:pointer;font-family:inherit;text-transform:uppercase;letter-spacing:.04em;}'
    + '.copy-btn:hover{background:var(--forest);color:#fff;}'
    + '.copy-btn.copied{background:var(--forest);color:#fff;}'
    + '.post-caption{font-size:.84rem;line-height:1.5;color:var(--text);white-space:pre-wrap;}'
    + '.post-mj{font-size:.74rem;line-height:1.45;color:var(--text-soft);font-family:ui-monospace,Menlo,monospace;background:rgba(0,0,0,.03);border-radius:6px;padding:8px 10px;}'
    + '</style>';

  el.innerHTML = markup;

  el.querySelectorAll('.content-month-head').forEach(function (head) {
    head.addEventListener('click', function () {
      const month = head.dataset.month;
      const body = document.getElementById('cm-' + month);
      const wrap = head.closest('.content-month');
      const open = body.style.display !== 'none';
      body.style.display = open ? 'none' : 'flex';
      wrap.classList.toggle('open', !open);
    });
  });

  el.addEventListener('click', function (e) {
    const btn = e.target.closest('.copy-btn');
    if (!btn) return;
    e.stopPropagation();
    const text = decodeURIComponent(btn.dataset.copy);
    navigator.clipboard.writeText(text).then(function () {
      const orig = btn.textContent;
      btn.textContent = 'Copied';
      btn.classList.add('copied');
      setTimeout(function () { btn.textContent = orig; btn.classList.remove('copied'); }, 1400);
    });
  });

  el.querySelectorAll('.filter-chip').forEach(function (chip) {
    chip.addEventListener('click', function () {
      el.querySelectorAll('.filter-chip').forEach(function (c) { c.classList.remove('active'); });
      chip.classList.add('active');
      const f = chip.dataset.filter;
      el.querySelectorAll('.post-card').forEach(function (card) {
        card.classList.toggle('hidden', f !== 'all' && card.dataset.tag !== f);
      });
    });
  });

  const brandFile = el.querySelector('#brandFile');
  const brandDrop = el.querySelector('#brandDrop');
  const brandDropTitle = el.querySelector('#brandDropTitle');
  const brandBtn = el.querySelector('#brandBtn');
  const brandStatus = el.querySelector('#brandStatus');
  const brandForm = el.querySelector('#brandForm');
  const previewWrap = el.querySelector('#brandPreviewWrap');
  const preview = el.querySelector('#brandPreview');
  const download = el.querySelector('#brandDownload');

  brandFile.addEventListener('change', function () {
    const f = brandFile.files && brandFile.files[0];
    brandDropTitle.textContent = f ? f.name : 'Tap to choose your Midjourney image';
    brandBtn.disabled = !f;
  });
  ['dragenter', 'dragover'].forEach(function (ev) { brandDrop.addEventListener(ev, function (e) { e.preventDefault(); brandDrop.classList.add('is-drag'); }); });
  ['dragleave', 'drop'].forEach(function (ev) { brandDrop.addEventListener(ev, function (e) { e.preventDefault(); brandDrop.classList.remove('is-drag'); }); });
  brandDrop.addEventListener('drop', function (e) {
    if (e.dataTransfer.files && e.dataTransfer.files[0]) { brandFile.files = e.dataTransfer.files; brandFile.dispatchEvent(new Event('change')); }
  });

  brandForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    const f = brandFile.files && brandFile.files[0];
    if (!f) return;
    const fd = new FormData();
    fd.append('photo', f);
    fd.append('headline', el.querySelector('#brandHeadline').value);
    fd.append('subtext', el.querySelector('#brandSub').value);
    brandBtn.disabled = true;
    brandStatus.className = 'gallery-status';
    brandStatus.textContent = 'Branding your image...';
    try {
      const r = await fetch('/admin/api/brand-image', { method: 'POST', body: fd });
      if (!r.ok) { const d = await r.json().catch(function () { return {}; }); throw new Error(d.error || 'Branding failed'); }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      preview.src = url;
      download.href = url;
      previewWrap.style.display = '';
      brandStatus.className = 'gallery-status ok';
      brandStatus.textContent = 'Done. Preview below, then download.';
      brandBtn.disabled = false;
    } catch (err) {
      brandStatus.className = 'gallery-status err';
      brandStatus.textContent = err.message;
      brandBtn.disabled = false;
    }
  });
}
