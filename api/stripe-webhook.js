// POST /api/stripe-webhook
// Stripe の Webhook を受け取り Supabase の subscription_status を更新する

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });
const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Vercel のボディパース無効化（生のバッファが必要）
export const config = { api: { bodyParser: false } };

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function mapStatus(stripeStatus) {
  const map = {
    active: 'active',
    trialing: 'trialing',
    past_due: 'past_due',
    canceled: 'canceled',
    incomplete: 'inactive',
    incomplete_expired: 'inactive',
    unpaid: 'past_due',
    paused: 'past_due',
  };
  return map[stripeStatus] || 'inactive';
}

async function handleSubscription(sub) {
  const status = mapStatus(sub.status);
  const meta = sub.metadata || {};

  if (meta.type === 'group' && meta.groupId) {
    await sb.from('groups').update({
      stripe_subscription_id: sub.id,
      subscription_status: status,
    }).eq('id', meta.groupId);
    console.log(`[webhook] group ${meta.groupId} → ${status}`);
  } else if (meta.type === 'member' && meta.memberId) {
    await sb.from('group_members').update({
      stripe_subscription_id: sub.id,
      subscription_status: status,
    }).eq('id', meta.memberId);
    console.log(`[webhook] member ${meta.memberId} → ${status}`);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const sig  = req.headers['stripe-signature'];
  const body = await getRawBody(req);

  let event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    console.error('[webhook] signature error:', e.message);
    return res.status(400).send(`Webhook Error: ${e.message}`);
  }

  const sub = event.data.object;
  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      await handleSubscription(sub);
      break;
    case 'invoice.payment_failed':
      // past_due は subscription.updated で処理されるため記録のみ
      console.log('[webhook] payment_failed for customer:', sub.customer);
      break;
  }

  res.json({ received: true });
}
