// POST /api/stripe-checkout
// body: { type: 'group'|'member', groupId, memberId, userId, returnUrl }
// type=group  → 管理者がグループ基本料金を支払う
// type=member → メンバーが個人料金を支払う

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

  const { type, groupId, memberId, userId, returnUrl } = req.body || {};
  if (!type || !userId) return res.status(400).json({ error: 'type and userId are required' });

  const origin = returnUrl || 'https://pleasure.delivery-every.com';
  const successUrl = `${origin}?billing=success&type=${type}`;
  const cancelUrl  = `${origin}?billing=cancel`;

  try {
    if (type === 'group') {
      if (!groupId) return res.status(400).json({ error: 'groupId required' });

      const { data: grp } = await sb.from('groups').select('*').eq('id', groupId).single();
      if (!grp) return res.status(404).json({ error: 'group not found' });

      let customerId = grp.stripe_customer_id;
      if (!customerId) {
        const { data: authUser } = await sb.auth.admin.getUserById(userId);
        const customer = await stripe.customers.create({
          email: authUser?.user?.email,
          metadata: { groupId, userId, type: 'group' },
        });
        customerId = customer.id;
        await sb.from('groups').update({ stripe_customer_id: customerId }).eq('id', groupId);
      }

      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: 'subscription',
        line_items: [{ price: process.env.STRIPE_GROUP_PRICE_ID, quantity: 1 }],
        subscription_data: { metadata: { groupId, userId, type: 'group' } },
        success_url: successUrl,
        cancel_url: cancelUrl,
        locale: 'ja',
      });

      return res.json({ url: session.url });
    }

    if (type === 'member') {
      if (!memberId || !groupId) return res.status(400).json({ error: 'memberId and groupId required' });

      const { data: mem } = await sb.from('group_members').select('*').eq('id', memberId).single();
      if (!mem) return res.status(404).json({ error: 'member not found' });

      let customerId = mem.stripe_customer_id;
      if (!customerId) {
        const { data: authUser } = await sb.auth.admin.getUserById(userId);
        const customer = await stripe.customers.create({
          email: authUser?.user?.email,
          metadata: { memberId, groupId, userId, type: 'member' },
        });
        customerId = customer.id;
        await sb.from('group_members').update({ stripe_customer_id: customerId }).eq('id', memberId);
      }

      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: 'subscription',
        line_items: [{ price: process.env.STRIPE_MEMBER_PRICE_ID, quantity: 1 }],
        subscription_data: { metadata: { memberId, groupId, userId, type: 'member' } },
        success_url: successUrl,
        cancel_url: cancelUrl,
        locale: 'ja',
      });

      return res.json({ url: session.url });
    }

    return res.status(400).json({ error: 'invalid type' });
  } catch (e) {
    console.error('[stripe-checkout]', e.message);
    return res.status(500).json({ error: e.message });
  }
}
