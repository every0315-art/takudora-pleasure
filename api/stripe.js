// /api/stripe?action=checkout|portal|webhook
// stripe-checkout.js / stripe-portal.js / stripe-webhook.js を統合
// Hobbyプランの Serverless Functions 上限（12個）を超えないための統合

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });
const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// webhook の署名検証に生のボディが必要なため、bodyParser は常に無効化
export const config = { api: { bodyParser: false } };

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// ---- checkout ----
async function handleCheckout(req, res, body) {
  const { type, groupId, memberId, userId, returnUrl } = body || {};
  if (!type || !userId) return res.status(400).json({ error: 'type and userId are required' });

  const origin = returnUrl || 'https://pleasure.delivery-every.com';
  const successUrl = `${origin}?billing=success&type=${type}`;
  const cancelUrl  = `${origin}?billing=cancel`;

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
}

// ---- portal ----
async function handlePortal(req, res, body) {
  const { type, groupId, memberId } = body || {};
  const returnUrl = 'https://pleasure.delivery-every.com';

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
}

// ---- webhook ----
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

async function handleWebhook(req, res, rawBody) {
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
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
      console.log('[webhook] payment_failed for customer:', sub.customer);
      break;
  }

  return res.json({ received: true });
}

export default async function handler(req, res) {
  const action = req.query.action;

  if (action === 'webhook') {
    const rawBody = await getRawBody(req);
    try {
      return await handleWebhook(req, res, rawBody);
    } catch (e) {
      console.error('[stripe:webhook]', e.message);
      return res.status(500).json({ error: e.message });
    }
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const rawBody = await getRawBody(req);
  let body = {};
  try {
    body = rawBody.length ? JSON.parse(rawBody.toString('utf8')) : {};
  } catch (e) {
    return res.status(400).json({ error: 'invalid JSON body' });
  }

  try {
    if (action === 'checkout') return await handleCheckout(req, res, body);
    if (action === 'portal') return await handlePortal(req, res, body);
    return res.status(400).json({ error: 'invalid action' });
  } catch (e) {
    console.error(`[stripe:${action}]`, e.message);
    return res.status(500).json({ error: e.message });
  }
}
