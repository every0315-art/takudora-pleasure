// POST /api/stripe-portal
// body: { type: 'group'|'member', groupId, memberId }
// → Stripe Customer Portal セッションURLを返す

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });
const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { type, groupId, memberId } = req.body || {};
  const returnUrl = 'https://pleasure.delivery-every.com';

  try {
    let customerId;
    if (type === 'group' && groupId) {
      const { data } = await sb.from('groups').select('stripe_customer_id').eq('id', groupId).single();
      customerId = data?.stripe_customer_id;
    } else if (type === 'member' && memberId) {
      const { data } = await sb.from('group_members').select('stripe_customer_id').eq('id', memberId).single();
      customerId = data?.stripe_customer_id;
    }

    if (!customerId) return res.status(400).json({ error: 'no stripe customer found' });

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });

    return res.json({ url: session.url });
  } catch (e) {
    console.error('[stripe-portal]', e.message);
    return res.status(500).json({ error: e.message });
  }
}
