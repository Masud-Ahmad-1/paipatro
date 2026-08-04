// ভিউ-কাউন্ট প্রতিদিন/মাসে ভাগ করার জন্য — বাংলাদেশ সময় (Asia/Dhaka) অনুযায়ী দিনের হিসাব রাখা হয়,
// যাতে "আজকের ভিউ" সত্যিকারের বাংলাদেশ সময়ের দিন অনুযায়ী গোনা হয়, সার্ভারের UTC দিন অনুযায়ী না।

function dayBucket(date = new Date()) {
  // ফলাফল: "YYYY-MM-DD" (Asia/Dhaka)
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return fmt.format(date); // en-CA লোকেল ISO-এর মতো YYYY-MM-DD ফরম্যাট দেয়
}

function monthBucket(date = new Date()) {
  return dayBucket(date).slice(0, 7); // "YYYY-MM"
}

module.exports = { dayBucket, monthBucket };
