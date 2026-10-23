const db = process.env.DATABASE_URL;
const stripe = process.env.STRIPE_KEY;
const hook = process.env.STRIPE_WEBHOOK_SECRET;
const port = process.env.PORT;           // undocumented!
const legacy = process.env.OLD_FEATURE;  // also undocumented
