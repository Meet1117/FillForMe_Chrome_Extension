/**
 * Built-in random test-data generator (no external libraries).
 *
 * Used for the "Random" value mode, as the fallback when AI values are invalid,
 * and when no Groq key is set. It guesses what a field wants from its label, name,
 * autocomplete, placeholder and type, and respects min / max / maxlength / pattern.
 *
 * A "persona" keeps one fill consistent: the email matches the name, the city matches
 * the state and postal code, end dates come after start dates, and so on.
 *
 * Emails use example.com and phone numbers use reserved/fictional ranges where a
 * country has one, so test data never reaches real people.
 */
(function (root) {
  'use strict';
  const FP = (root.FPShared = root.FPShared || {});
  if (FP.Gen) return;

  /* ---------- small helpers ---------- */
  const rand = (n) => Math.floor(Math.random() * n);
  const pick = (arr) => arr[rand(arr.length)];
  const randInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
  const digits = (n) => Array.from({ length: n }, () => rand(10)).join('');
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '');
  const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const LOWER = 'abcdefghijklmnopqrstuvwxyz';
  const DIGITS = '0123456789';
  const ALNUM = UPPER + LOWER + DIGITS;
  const upper = (n) => Array.from({ length: n }, () => pick(UPPER)).join('');

  /* ---------- locale data ---------- */
  const LOCALES = {
    IN: {
      label: 'India',
      country: 'India',
      first: ['Aarav', 'Vivaan', 'Aditya', 'Arjun', 'Rohan', 'Karan', 'Rahul', 'Siddharth', 'Nikhil', 'Pranav',
        'Ananya', 'Diya', 'Priya', 'Sneha', 'Kavya', 'Isha', 'Meera', 'Pooja', 'Riya', 'Neha', 'Aisha', 'Tanvi'],
      last: ['Sharma', 'Patel', 'Mehta', 'Iyer', 'Reddy', 'Nair', 'Gupta', 'Joshi', 'Desai', 'Kulkarni',
        'Singh', 'Rao', 'Shah', 'Verma', 'Menon', 'Chopra', 'Bose', 'Pillai', 'Banerjee', 'Kapoor'],
      cities: [
        { city: 'Mumbai', state: 'Maharashtra', zip: '4000' },
        { city: 'Pune', state: 'Maharashtra', zip: '4110' },
        { city: 'New Delhi', state: 'Delhi', zip: '1100' },
        { city: 'Bengaluru', state: 'Karnataka', zip: '5600' },
        { city: 'Chennai', state: 'Tamil Nadu', zip: '6000' },
        { city: 'Hyderabad', state: 'Telangana', zip: '5000' },
        { city: 'Ahmedabad', state: 'Gujarat', zip: '3800' },
        { city: 'Surat', state: 'Gujarat', zip: '3950' },
        { city: 'Kolkata', state: 'West Bengal', zip: '7000' },
        { city: 'Jaipur', state: 'Rajasthan', zip: '3020' },
        { city: 'Lucknow', state: 'Uttar Pradesh', zip: '2260' },
        { city: 'Kochi', state: 'Kerala', zip: '6820' },
      ],
      streets: ['MG Road', 'Link Road', 'Station Road', 'Nehru Nagar', 'Park Street', 'SV Road',
        'Linking Road', 'Ring Road', 'Gandhi Marg', 'Lake View Road'],
      areas: ['Andheri West', 'Koregaon Park', 'Indiranagar', 'Banjara Hills', 'Salt Lake', 'Navrangpura',
        'Powai', 'Vashi', 'Jayanagar', 'Bandra East'],
      zip: (p) => p.zip + pad(randInt(1, 99)),
      phone: () => pick(['9', '8', '7', '6']) + digits(9),
      dateFormat: 'DMY',
      companyWords: ['Shree', 'Sai', 'Om', 'Tata', 'Sagar', 'Ganga', 'Surya', 'Kaveri', 'Nirmal', 'Pratham'],
      companySuffix: ['Enterprises', 'Industries', 'Traders', 'Pvt Ltd', 'Solutions', 'Hotels', 'Labs', 'Foods'],
    },
    US: {
      label: 'United States',
      country: 'United States',
      first: ['James', 'Olivia', 'Liam', 'Emma', 'Noah', 'Ava', 'Ethan', 'Sophia', 'Mason', 'Mia',
        'Lucas', 'Harper', 'Logan', 'Ella', 'Jacob', 'Grace', 'Daniel', 'Chloe', 'Henry', 'Lily'],
      last: ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Miller', 'Davis', 'Garcia', 'Wilson', 'Anderson',
        'Taylor', 'Thomas', 'Moore', 'Martin', 'Lee', 'Clark', 'Walker', 'Hall', 'Young', 'King'],
      cities: [
        { city: 'New York', state: 'New York', zip: '100' },
        { city: 'Los Angeles', state: 'California', zip: '900' },
        { city: 'San Francisco', state: 'California', zip: '941' },
        { city: 'Chicago', state: 'Illinois', zip: '606' },
        { city: 'Houston', state: 'Texas', zip: '770' },
        { city: 'Austin', state: 'Texas', zip: '787' },
        { city: 'Seattle', state: 'Washington', zip: '981' },
        { city: 'Boston', state: 'Massachusetts', zip: '021' },
        { city: 'Denver', state: 'Colorado', zip: '802' },
        { city: 'Miami', state: 'Florida', zip: '331' },
        { city: 'Phoenix', state: 'Arizona', zip: '850' },
      ],
      streets: ['Main St', 'Oak Ave', 'Maple Dr', 'Cedar Ln', 'Pine St', 'Elm St', 'Washington Ave',
        'Lake Shore Dr', 'Park Ave', 'Sunset Blvd'],
      areas: ['Suite 100', 'Apt 4B', 'Unit 12', 'Floor 3', 'Suite 210'],
      zip: (p) => p.zip + pad(randInt(1, 99)),
      phone: () => `${pick(['212', '415', '312', '512', '206', '617', '303'])}-555-01${pad(randInt(0, 99))}`,
      dateFormat: 'MDY',
      companyWords: ['Summit', 'Bluewater', 'Northstar', 'Evergreen', 'Pioneer', 'Redwood', 'Atlas', 'Liberty'],
      companySuffix: ['Inc', 'LLC', 'Group', 'Labs', 'Partners', 'Holdings', 'Hospitality', 'Systems'],
    },
    UK: {
      label: 'United Kingdom',
      country: 'United Kingdom',
      first: ['Oliver', 'Amelia', 'George', 'Isla', 'Harry', 'Ava', 'Jack', 'Freya', 'Charlie', 'Poppy',
        'Thomas', 'Emily', 'Oscar', 'Sophie', 'William', 'Lucy', 'Alfie', 'Grace', 'Arthur', 'Evie'],
      last: ['Smith', 'Jones', 'Taylor', 'Brown', 'Williams', 'Wilson', 'Evans', 'Thomas', 'Roberts', 'Walker',
        'Wright', 'Hughes', 'Edwards', 'Green', 'Hall', 'Wood', 'Clarke', 'Harris', 'Lewis', 'Patel'],
      cities: [
        { city: 'London', state: 'Greater London', zip: 'EC1A' },
        { city: 'Manchester', state: 'Greater Manchester', zip: 'M1' },
        { city: 'Birmingham', state: 'West Midlands', zip: 'B1' },
        { city: 'Leeds', state: 'West Yorkshire', zip: 'LS1' },
        { city: 'Liverpool', state: 'Merseyside', zip: 'L1' },
        { city: 'Bristol', state: 'Bristol', zip: 'BS1' },
        { city: 'Glasgow', state: 'Scotland', zip: 'G1' },
        { city: 'Edinburgh', state: 'Scotland', zip: 'EH1' },
      ],
      streets: ['High Street', 'Station Road', 'Church Lane', 'Victoria Road', 'Green Lane', 'Mill Lane',
        'Park Road', 'Queen Street', 'King Street', 'London Road'],
      areas: ['Flat 2', 'Flat 5B', 'Unit 3', 'Suite 4', 'Apartment 12'],
      zip: (p) => `${p.zip} ${randInt(1, 9)}${upper(2).replace(/[CIKMOV]/g, 'A')}`,
      phone: () => `07700 900${pad(randInt(0, 999), 3)}`,
      dateFormat: 'DMY',
      companyWords: ['Thames', 'Albion', 'Crown', 'Highland', 'Kingsway', 'Oakwood', 'Brunel', 'Windsor'],
      companySuffix: ['Ltd', 'plc', 'Group', 'Services', 'Partners', 'Hotels', 'Consulting', 'Labs'],
    },
  };

  const JOB_TITLES = ['Operations Manager', 'Quality Analyst', 'Accountant', 'Sales Executive', 'Project Lead',
    'Procurement Officer', 'Lab Technician', 'Facility Manager', 'Software Engineer', 'HR Executive'];
  const WORDS = ['routine', 'quarterly', 'inspection', 'sample', 'review', 'pending', 'priority', 'standard',
    'follow-up', 'verified', 'scheduled', 'monthly', 'batch', 'client', 'requested', 'site', 'report'];
  const SENTENCES = [
    'Please process this request at the earliest.',
    'All details have been verified with the client.',
    'Contact the site manager before the visit.',
    'This is a routine monthly request.',
    'Samples were collected and stored as per the standard procedure.',
    'Invoice to be shared with the accounts team.',
    'Priority handling requested by the customer.',
    'Previous report is attached for reference.',
  ];

  /* ---------- persona ---------- */

  function createPersona(localeCode = 'IN') {
    const code = LOCALES[localeCode] ? localeCode : 'IN';
    const L = LOCALES[code];
    const first = pick(L.first);
    const last = pick(L.last);
    const place = pick(L.cities);
    const company = `${pick(L.companyWords)} ${pick(L.companySuffix)}`;
    const today = new Date();
    const start = addDays(today, -randInt(0, 10));
    return {
      locale: code,
      first,
      last,
      full: `${first} ${last}`,
      email: `${first}.${last}${randInt(1, 99)}@example.com`.toLowerCase(),
      phone: L.phone(),
      company,
      jobTitle: pick(JOB_TITLES),
      street: `${randInt(1, 250)}, ${pick(L.streets)}`,
      address2: pick(L.areas),
      city: place.city,
      state: place.state,
      zip: L.zip(place),
      country: L.country,
      website: `https://www.${slug(company)}.example.com`,
      username: `${slug(first)}${slug(last).slice(0, 3)}${randInt(10, 99)}`,
      dob: isoDate(addDays(today, -randInt(22 * 365, 58 * 365))),
      startDate: isoDate(start),
      endDate: isoDate(addDays(start, randInt(7, 45))),
    };
  }

  /* ---------- dates ---------- */

  function addDays(d, n) {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
  }
  function isoDate(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  function parseISODate(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }
  function isoWeek(d) {
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const day = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    const week = Math.ceil(((t - yearStart) / 86400000 + 1) / 7);
    return `${t.getUTCFullYear()}-W${pad(week)}`;
  }

  /** Format a Date for an input type (or a text field with a date-ish placeholder). */
  function formatDate(d, type, hint, locale) {
    const time = `${pad(randInt(9, 17))}:${pick(['00', '15', '30', '45'])}`;
    switch (type) {
      case 'datetime-local': return `${isoDate(d)}T${time}`;
      case 'month': return isoDate(d).slice(0, 7);
      case 'week': return isoWeek(d);
      case 'time': return time;
      case 'date': return isoDate(d);
      default: {
        // Text field: follow the placeholder ("dd/mm/yyyy") or the locale's order.
        const h = String(hint || '').toLowerCase();
        const dd = pad(d.getDate()), mm = pad(d.getMonth() + 1), yyyy = d.getFullYear();
        const sep = h.includes('-') ? '-' : h.includes('.') ? '.' : '/';
        if (/y{4}.?m{2}.?d{2}/.test(h)) return `${yyyy}${sep}${mm}${sep}${dd}`;
        if (/m{2}.?d{2}.?y{2,4}/.test(h)) return `${mm}${sep}${dd}${sep}${yyyy}`;
        if (/d{2}.?m{2}.?y{2,4}/.test(h)) return `${dd}${sep}${mm}${sep}${yyyy}`;
        const order = (LOCALES[locale] || LOCALES.IN).dateFormat;
        return order === 'MDY' ? `${mm}/${dd}/${yyyy}` : `${dd}/${mm}/${yyyy}`;
      }
    }
  }

  /** Pick a date based on what the label suggests (DOB → past, due date → future…). */
  function dateFor(field, persona, text) {
    const today = new Date();
    let d;
    if (/birth|dob|bday/.test(text)) d = parseISODate(persona.dob);
    else if (/\b(end|to|till|until|expir\w*|due|deadline|deliver\w*|valid|next|follow|return|check.?out|completion|closing)\b/.test(text))
      d = parseISODate(persona.endDate) || addDays(today, randInt(3, 45));
    else if (/\b(start|from|issue\w*|collect\w*|receiv\w*|join\w*|sampl\w*|order\w*|invoice|purchase|check.?in|commence\w*|visit\w*)\b/.test(text))
      d = parseISODate(persona.startDate) || addDays(today, -randInt(0, 10));
    else d = addDays(today, randInt(-5, 5));

    // Respect min / max attributes.
    const min = parseISODate(field.min);
    const max = parseISODate(field.max);
    if (min && d < min) d = addDays(min, randInt(0, 10));
    if (max && d > max) d = addDays(max, -randInt(0, 10));
    if (min && d < min) d = min;
    return formatDate(d, field.kind, field.placeholder, persona.locale);
  }

  /* ---------- regex → matching string ---------- */

  /**
   * Generate a string that matches a (simple) regular expression, used for `pattern`.
   * Supports literals, escapes (\d \w \s), classes [a-z0-9], groups (a|b), (?:…),
   * and quantifiers ? * + {n} {n,} {n,m}. Lookaheads are skipped.
   */
  function fromPattern(src) {
    let i = 0;
    const set = (chars) => ({ t: 'set', chars });
    function parseAlt() {
      const branches = [parseSeq()];
      while (src[i] === '|') { i++; branches.push(parseSeq()); }
      return { t: 'alt', branches };
    }
    function parseSeq() {
      const items = [];
      while (i < src.length && src[i] !== '|' && src[i] !== ')') {
        let atom = parseAtom();
        if (atom) items.push(parseQuant(atom));
        else parseQuant({ t: 'lit', v: '' });
      }
      return { t: 'seq', items };
    }
    function parseAtom() {
      const c = src[i++];
      if (c === '^' || c === '$') return null;
      if (c === '(') {
        if (src[i] === '?') {
          if (src[i + 1] === ':') i += 2;
          else if (src[i + 1] === '=' || src[i + 1] === '!' || (src[i + 1] === '<' && /[=!]/.test(src[i + 2]))) {
            let depth = 1;
            i += 2;
            while (i < src.length && depth) {
              if (src[i] === '\\') i++;
              else if (src[i] === '(') depth++;
              else if (src[i] === ')') depth--;
              i++;
            }
            return null;
          } else if (src[i + 1] === '<') i = src.indexOf('>', i) + 1;
        }
        const node = parseAlt();
        i++; // ')'
        return node;
      }
      if (c === '[') return parseClass();
      if (c === '\\') return parseEscape();
      if (c === '.') return set(ALNUM);
      return { t: 'lit', v: c };
    }
    function parseEscape() {
      const c = src[i++];
      switch (c) {
        case 'd': return set(DIGITS);
        case 'w': return set(ALNUM);
        case 's': return set(' ');
        case 'D': return set(UPPER);
        case 'W': return set('-');
        case 'S': return set(ALNUM);
        case 'b': case 'B': return null;
        default: return { t: 'lit', v: c };
      }
    }
    function parseClass() {
      let neg = false;
      if (src[i] === '^') { neg = true; i++; }
      let chars = '';
      let first = true;
      while (i < src.length && (src[i] !== ']' || first)) {
        first = false;
        let c = src[i++];
        if (c === '\\') {
          const e = src[i++];
          if (e === 'd') { chars += DIGITS; continue; }
          if (e === 'w') { chars += ALNUM + '_'; continue; }
          if (e === 's') { chars += ' '; continue; }
          c = e;
        }
        if (src[i] === '-' && src[i + 1] && src[i + 1] !== ']') {
          i++;
          let end = src[i++];
          if (end === '\\') end = src[i++];
          for (let k = c.charCodeAt(0); k <= end.charCodeAt(0); k++) chars += String.fromCharCode(k);
        } else chars += c;
      }
      i++; // ']'
      if (neg) chars = ALNUM.split('').filter((ch) => !chars.includes(ch)).join('') || 'x';
      return set(chars || 'x');
    }
    function parseQuant(atom) {
      let min = 1, max = 1;
      const c = src[i];
      if (c === '?') { min = 0; max = 1; i++; }
      else if (c === '*') { min = 0; max = 3; i++; }
      else if (c === '+') { min = 1; max = 4; i++; }
      else if (c === '{') {
        const m = /^\{(\d+)(,(\d*))?\}/.exec(src.slice(i));
        if (!m) return atom;
        min = +m[1];
        max = m[2] ? (m[3] ? +m[3] : min + 3) : min;
        i += m[0].length;
      } else return atom;
      if (src[i] === '?' || src[i] === '+') i++;
      return { t: 'rep', atom, min, max };
    }
    function gen(n) {
      switch (n.t) {
        case 'alt': return gen(pick(n.branches));
        case 'seq': return n.items.map(gen).join('');
        case 'lit': return n.v;
        case 'set': return pick(n.chars.split(''));
        case 'rep': {
          const k = randInt(n.min, Math.min(n.max, n.min + 6));
          let s = '';
          for (let j = 0; j < k; j++) s += gen(n.atom);
          return s;
        }
        default: return '';
      }
    }
    try {
      return gen(parseAlt());
    } catch {
      return '';
    }
  }

  /** Test a value against an HTML `pattern` attribute (whole-value match). */
  function matchesPattern(value, pattern) {
    if (!pattern) return true;
    for (const flags of ['v', 'u', '']) {
      try {
        return new RegExp(`^(?:${pattern})$`, flags).test(value);
      } catch { /* try next flag set */ }
    }
    return true; // invalid pattern: browsers ignore it too
  }

  /* ---------- options (select / radio / checkbox group) ---------- */

  /** Options like "Select…", "-- choose --" or an empty value are placeholders. */
  function isPlaceholderOption(opt) {
    if (!opt || opt.disabled) return true;
    if (opt.value === '' || opt.value == null) return true;
    const text = String(opt.text || '').trim().toLowerCase();
    return /^-+$/.test(text) || /^\W*(select|choose|pick|please select)\b/.test(text);
  }

  function realOptions(field) {
    return (field.options || []).filter((o) => !isPlaceholderOption(o));
  }

  /** Find an option whose text includes the wanted text (used for persona consistency). */
  function findOptionLike(options, wanted) {
    if (!wanted) return null;
    const w = String(wanted).toLowerCase();
    return (
      options.find((o) => String(o.text).toLowerCase() === w || String(o.value).toLowerCase() === w) ||
      options.find((o) => String(o.text).toLowerCase().includes(w)) ||
      null
    );
  }

  /* ---------- semantic detection ---------- */

  /** Text used to guess what a field is about. */
  function hintText(field) {
    return [field.label, field.name, field.id, field.placeholder, field.autocomplete, field.ariaLabel]
      .filter(Boolean)
      .join(' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2') // camelCase → words
      .replace(/[_\-.[\]]+/g, ' ')
      .toLowerCase();
  }

  const AUTOCOMPLETE_MAP = {
    'given-name': 'firstName', 'family-name': 'lastName', 'additional-name': 'middleName', name: 'fullName',
    email: 'email', tel: 'phone', 'tel-national': 'phone', 'postal-code': 'zip', 'address-level2': 'city',
    'address-level1': 'state', 'country-name': 'country', country: 'country', 'street-address': 'address',
    'address-line1': 'address', 'address-line2': 'address2', organization: 'company', bday: 'dob',
    url: 'website', username: 'username', 'new-password': 'password', 'current-password': 'password',
    'organization-title': 'jobTitle',
  };

  const RULES = [
    ['email', /e.?mail/],
    ['password', /passw|pwd/],
    ['firstName', /first ?name|\bfname\b|given ?name|forename/],
    ['lastName', /last ?name|\blname\b|surname|family ?name/],
    ['middleName', /middle ?name/],
    ['username', /user ?name|login ?id|user ?id/],
    ['company', /company|organi[sz]ation|business ?name|firm|employer|vendor|supplier|agency|(hotel|shop|store|restaurant|clinic|hospital|school|lab|branch) ?name/],
    ['jobTitle', /designation|job ?title|position|occupation|\brole\b/],
    ['pan', /\bpan\b|pan ?(no|number|card)/],
    ['gstin', /\bgst/],
    ['aadhaar', /aadha?ar/],
    ['ifsc', /\bifsc/],
    ['phone', /phone|mobile|\bcell|contact ?(no|number)|\btel\b|whats ?app/],
    ['zip', /\bzip|postal|post ?code|pin ?code|\bpin\b/],
    ['city', /\bcity|\btown|district/],
    ['state', /\bstate\b|province|region|county/],
    ['country', /country|nation/],
    ['address2', /address ?(line)? ?2|apartment|suite|\bapt\b|landmark|area|locality/],
    ['address', /address|street|\baddr|location/],
    ['website', /website|\burl\b|homepage|web ?site|\blink\b/],
    ['dob', /birth|\bdob\b|bday/],
    ['age', /\bage\b/],
    ['code', /\bid\b|reference|\bref\b|\bcode\b|serial|invoice ?(no|number)\b|order ?(no|number)\b/],
    ['title', /title|subject|heading|project|product|item|event|course/],
    ['fullName', /full ?name|^name$|\bname\b|contact ?person|customer|applicant|owner|person|guest|patient|signature/],
    ['description', /descri|notes?\b|remark|comment|message|details|about|summary|instruction|reason|feedback/],
    ['amount', /amount|price|cost|rate|fee|salary|total|budget|charge|value|income/],
    ['quantity', /\bqty|quantity|count|number of|no\.? ?of|units|pieces|samples/],
    ['percent', /percent|%|discount/],
    ['year', /\byear\b/],
    ['code', /number|\bno\b/],
  ];

  /** What kind of data a field wants, e.g. "email", "city", "amount", "text". */
  function semantic(field) {
    const ac = String(field.autocomplete || '').toLowerCase().split(/\s+/).pop();
    if (AUTOCOMPLETE_MAP[ac]) return AUTOCOMPLETE_MAP[ac];
    const t = field.kind;
    if (t === 'email') return 'email';
    if (t === 'tel') return 'phone';
    if (t === 'url') return 'website';
    if (t === 'password') return 'password';
    const text = hintText(field);
    for (const [kind, re] of RULES) if (re.test(text)) return kind;
    if (t === 'textarea' || t === 'contenteditable') return 'description';
    return 'text';
  }

  /* ---------- numbers ---------- */

  function numberFor(field, sem) {
    let min = field.min !== '' && field.min != null && !isNaN(+field.min) ? +field.min : null;
    let max = field.max !== '' && field.max != null && !isNaN(+field.max) ? +field.max : null;
    const step = field.step && field.step !== 'any' && !isNaN(+field.step) ? +field.step : null;
    let lo, hi;
    switch (sem) {
      case 'age': lo = 18; hi = 65; break;
      case 'quantity': lo = 1; hi = 20; break;
      case 'percent': lo = 1; hi = 100; break;
      case 'year': lo = 2000; hi = new Date().getFullYear(); break;
      case 'amount': lo = 100; hi = 50000; break;
      case 'zip': return null;
      default: lo = 1; hi = 100;
    }
    if (min != null) lo = Math.max(lo, min);
    if (max != null) hi = Math.min(hi, max);
    if (lo > hi) { lo = min ?? hi; hi = max ?? lo; }
    if (lo > hi) [lo, hi] = [hi, lo];
    let n = lo + Math.random() * (hi - lo);
    if (step) {
      const base = min ?? 0;
      n = base + Math.round((n - base) / step) * step;
      if (max != null && n > max) n -= step;
      if (min != null && n < min) n += step;
      const decimals = (String(step).split('.')[1] || '').length;
      return n.toFixed(decimals);
    }
    if (sem === 'amount' && (!step || step < 1)) return String(Math.round(n));
    return String(Math.round(n));
  }

  /* ---------- text by meaning ---------- */

  function textFor(sem, field, persona) {
    switch (sem) {
      case 'email': return persona.email;
      case 'password': return 'Test@' + randInt(1000, 9999);
      case 'firstName': return persona.first;
      case 'lastName': return persona.last;
      case 'middleName': return pick(LOCALES[persona.locale].first);
      case 'fullName': return persona.full;
      case 'username': return persona.username;
      case 'company': return persona.company;
      case 'jobTitle': return persona.jobTitle;
      case 'phone': return persona.phone;
      case 'zip': return persona.zip;
      case 'city': return persona.city;
      case 'state': return persona.state;
      case 'country': return persona.country;
      case 'address': return field.kind === 'textarea'
        ? `${persona.street}, ${persona.address2}, ${persona.city}, ${persona.state} ${persona.zip}`
        : persona.street;
      case 'address2': return persona.address2;
      case 'website': return persona.website;
      case 'pan': return upper(3) + 'P' + persona.last.charAt(0).toUpperCase() + digits(4) + upper(1);
      case 'gstin': return pad(randInt(1, 37)) + upper(5) + digits(4) + upper(1) + randInt(1, 9) + 'Z' + pick(ALNUM.slice(0, 36).split(''));
      case 'aadhaar': return String(randInt(2, 9)) + digits(11);
      case 'ifsc': return pick(['HDFC', 'ICIC', 'SBIN', 'UTIB', 'KKBK']) + '0' + digits(6);
      case 'age': case 'quantity': case 'percent': case 'year': case 'amount':
        return numberFor(field, sem);
      case 'dob': return dateFor({ ...field, kind: field.kind === 'text' ? 'text' : field.kind }, persona, 'dob');
      case 'description': {
        const n = field.kind === 'textarea' || field.kind === 'contenteditable' ? randInt(2, 3) : 1;
        const out = [];
        while (out.length < n) {
          const s = pick(SENTENCES);
          if (!out.includes(s)) out.push(s);
        }
        return out.join(' ');
      }
      case 'title': return `${cap(pick(WORDS))} ${pick(WORDS)} ${pick(['request', 'plan', 'report', 'order'])}`;
      case 'code': return `${upper(2)}-${digits(5)}`;
      default: {
        // Generic text: a short, readable phrase.
        return `${cap(pick(WORDS))} ${pick(WORDS)}`;
      }
    }
  }

  /** Trim/repair a generated value so it fits maxlength / minlength / pattern. */
  function constrain(value, field) {
    let v = String(value ?? '');
    if (field.pattern && !matchesPattern(v, field.pattern)) {
      for (let tries = 0; tries < 20; tries++) {
        const g = fromPattern(field.pattern);
        if (matchesPattern(g, field.pattern)) { v = g; break; }
      }
    }
    const maxLen = parseInt(field.maxlength, 10);
    if (maxLen > 0 && v.length > maxLen) {
      // Phone numbers: keep the last digits; everything else: cut at the end.
      v = /^[\d\s+()-]+$/.test(v) ? v.replace(/\D/g, '').slice(-maxLen) : v.slice(0, maxLen).trim();
    }
    const minLen = parseInt(field.minlength, 10);
    if (minLen > 0 && v.length < minLen) v = v.padEnd(minLen, 'x');
    return v;
  }

  /* ---------- main entry ---------- */

  /**
   * Produce a value (always a string) for a field description.
   * checkbox → "true"/"false"; checkbox-group → comma separated option values.
   */
  function valueFor(field, persona) {
    persona = persona || createPersona();
    const kind = field.kind;
    const sem = semantic(field);
    const text = hintText(field);

    if (kind === 'select' || kind === 'radio' || kind === 'custom-select') {
      const opts = realOptions(field);
      if (!opts.length) return kind === 'custom-select' ? '' : (field.options?.[0]?.value ?? '');
      const wanted = { state: persona.state, city: persona.city, country: persona.country }[sem];
      const match = findOptionLike(opts, wanted);
      return (match || pick(opts)).value;
    }
    if (kind === 'checkbox') {
      if (field.required || /agree|accept|terms|consent|confirm/.test(text)) return 'true';
      return Math.random() < 0.6 ? 'true' : 'false';
    }
    if (kind === 'checkbox-group') {
      const opts = realOptions(field);
      if (!opts.length) return '';
      const shuffled = opts.slice().sort(() => Math.random() - 0.5);
      return shuffled.slice(0, randInt(1, Math.min(3, opts.length))).map((o) => o.value).join(',');
    }
    if (['date', 'datetime-local', 'month', 'week', 'time'].includes(kind)) {
      if (kind === 'time') {
        const v = formatDate(new Date(), 'time');
        return field.min && v < field.min ? field.min : field.max && v > field.max ? field.max : v;
      }
      return dateFor(field, persona, text);
    }
    if (kind === 'number' || kind === 'range') {
      return numberFor(field, ['age', 'quantity', 'percent', 'year', 'amount'].includes(sem) ? sem : 'number');
    }
    if (kind === 'color') return '#' + Array.from({ length: 3 }, () => pad(rand(256).toString(16))).join('');
    if (kind === 'file') return '';

    // Text-like fields whose label says "date".
    if (sem === 'text' && /\bdate\b/.test(text)) return constrain(dateFor({ ...field, kind: 'text' }, persona, text), field);
    return constrain(textFor(sem, field, persona), field);
  }

  FP.Gen = {
    LOCALES,
    createPersona,
    valueFor,
    semantic,
    fromPattern,
    matchesPattern,
    isPlaceholderOption,
    realOptions,
    formatDate,
    isoDate,
    parseISODate,
    _helpers: { randInt, pick },
  };
})(globalThis);
