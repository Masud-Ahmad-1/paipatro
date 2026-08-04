const bnDigits = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
const bnMonths = ['জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন', 'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'];

function toBn(n) { return String(n).split('').map(d => /[0-9]/.test(d) ? bnDigits[+d] : d).join(''); }
function formatBnDate(d) { return `${toBn(d.getDate())} ${bnMonths[d.getMonth()]}, ${toBn(d.getFullYear())}`; }
function estimateReadTime(paragraphs) {
  const words = paragraphs.join(' ').trim().split(/\s+/).filter(Boolean).length;
  const mins = Math.max(1, Math.round(words / 180));
  return `${toBn(mins)} মিনিট`;
}

module.exports = { toBn, formatBnDate, estimateReadTime };
