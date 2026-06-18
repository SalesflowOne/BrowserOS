import type { Scenario, ScenarioId } from './types'

/**
 * Demo #2 — Resident maintenance request (pool pump).
 * Faithful copy of the operator-approved design in
 * DESIGNS/claude_designs/BrowserOS-hoa/BrowserOS Flows.dc.html.
 */
const MAINTENANCE: Scenario = {
  id: 'maintenance',
  label: 'Maintenance request',
  workspace: 'Crestline Mgmt',
  agentName: 'Julius',
  recentSites: [
    { tag: 'P', name: 'Maple Ridge', color: '#11998E' },
    { tag: 'M', name: 'Inbox', color: '#E2574C' },
    { tag: 'G', name: 'Google', color: '#4285F4' },
    { tag: 'B', name: 'Board', color: '#5B6470' },
    { tag: '$', name: 'Operating', color: '#1F7A4D' },
  ],
  surfaces: {
    P: {
      tag: 'P',
      name: 'Maple Ridge HOA — Management Portal',
      color: '#11998E',
      sections: ['Requests', 'CC&Rs', 'Vendors', 'Accounting'],
    },
    M: {
      tag: 'M',
      name: 'Inbox — Board email thread',
      color: '#E2574C',
      sections: ['Inbox', 'Sent', 'Board'],
    },
  },
  toolCount: 2,
  userMsg:
    'Hey Julius — a resident at Maple Ridge says the community pool’s gone cloudy and the pump is dead. Let me show you how we run a repair like this, so you can take it next time.',
  replyFull:
    'Absolutely — I’d love to learn! Let me pull up the recording interface for you. Go ahead and walk me through the repair exactly the way your team handles it, and I’ll watch and learn.',
  rec: [
    {
      surface: 'P',
      crumb: 'Requests › #MR-4471',
      title: 'Opened the resident request',
      detail: '1442 Maple Ct · “Pool is cloudy, pump is dead”',
      say: "A resident at Maple Ridge just reported the pool pump is dead — it's July, so this is urgent.",
    },
    {
      surface: 'P',
      crumb: 'Requests › #MR-4471',
      title: 'Sent the auto-acknowledgement',
      detail: 'Ticket #MR-4471 created · resident notified',
      say: "First thing, the portal auto-acknowledges so the resident knows we've got it.",
    },
    {
      surface: 'P',
      crumb: 'CC&Rs › Responsibility',
      title: 'Confirmed it’s a common amenity',
      detail: 'The pool is shared → HOA responsibility, not the owner',
      say: "The pool's a common amenity, so this is on the HOA, not the homeowner.",
    },
    {
      surface: 'P',
      crumb: 'Requests › Quote',
      title: 'Logged the repair quote',
      detail: 'New commercial pump — $6,000',
      say: "The pump quote came in around six thousand — that's over my twenty-five-hundred approval limit.",
    },
    {
      surface: 'P',
      crumb: 'Vendors › Bids',
      title: 'Collected three vendor bids',
      detail: 'AquaPro $6,000 · ClearWater $6,480 · BlueLine $7,150',
      say: "So I can't just authorize it — I pull three bids like the contract requires.",
    },
    {
      surface: 'M',
      crumb: 'To: HOA Board',
      title: 'Emailed the board with a recommendation',
      detail: '3 bids attached · recommend AquaPro · flagged urgent',
      say: 'Then I email the board all three bids and my recommendation.',
    },
    {
      surface: 'M',
      crumb: 'Board thread › Vote',
      title: 'Board approved by email vote',
      detail: '3 of 5 approved AquaPro — allowed for urgent items',
      say: "Because it's an active-summer emergency, the board can approve by email under our bylaws.",
    },
    {
      surface: 'P',
      crumb: 'Work order › Vendor',
      title: 'Assigned the vendor & turned on updates',
      detail: 'AquaPro scheduled · resident texted on each status change',
      say: 'I assign AquaPro and set it so every status update notifies the resident.',
    },
    {
      surface: 'P',
      crumb: 'Work order › Close',
      title: 'Verified the work, vendor added photos',
      detail: 'Pump installed in 2 days · photos + timestamps logged',
      say: "When it's done I verify it, the vendor uploads photos, and everything's timestamped.",
    },
    {
      surface: 'P',
      crumb: 'Accounting › Pay',
      title: 'Paid from operating funds',
      detail: 'Posts to next statement under “Pool Maintenance”',
      say: "Finally I pay it from operating funds — it lands on next month's statement under Pool Maintenance.",
    },
  ],
  proc: [
    { text: 'Identified the trigger: a resident maintenance request' },
    { text: 'Captured your $2,500 spending rule and the 3-bid step' },
    { text: 'Saved the board email-vote checkpoint as a human approval' },
    { text: 'Mapped it to 2 tools you already use — 0 APIs, 0 keys' },
  ],
  trigger: 'When a resident submits a maintenance request in the portal',
  steps: [
    {
      type: 'read',
      surface: 'P',
      text: 'Read the request, auto-acknowledge it with a ticket number, and notify the resident',
    },
    {
      type: 'decide',
      surface: 'P',
      text: 'Decide who’s responsible',
      sub: 'Common amenity → HOA. If it’s the owner’s item → notify them and close.',
    },
    {
      type: 'do',
      surface: 'P',
      text: 'Get the repair quote and log it on the ticket',
    },
    {
      type: 'branch',
      surface: 'P',
      text: 'Check it against your spending limit',
      sub: 'If the quote is over $2,500 → collect 3 bids first. If under → schedule the vendor directly.',
    },
    {
      type: 'human',
      surface: 'M',
      text: 'Email the board the 3 bids + a recommendation, and collect their vote',
      sub: 'Human checkpoint — nothing is ordered until the board approves (email vote allowed for urgent items).',
    },
    {
      type: 'do',
      surface: 'P',
      text: 'Assign the approved vendor and notify the resident on every status change',
    },
    {
      type: 'do',
      surface: 'P',
      text: 'On completion: verify the work, attach the vendor’s photos with timestamps, then pay from operating funds and post it to the statement under “Pool Maintenance”',
    },
  ],
  exception:
    'If the board hasn’t voted within 48 hours on an urgent item, send a reminder and flag it for you.',
  lockNote:
    'Julius runs this by driving the same portal you just used — no integrations, no API keys, nothing to set up.',
  saved: {
    agentTitle: 'Resident Repair Runner',
    watching: 'Maple Ridge — new requests in the portal queue',
    cadence: 'Runs on every new maintenance request, 24/7',
    guard: 'Always pauses for the board’s vote before anything over $2,500',
    metric: 'Manager touch time per repair: ~40 min → one approval click',
  },
}

/**
 * Demo #1 — Estoppel / resale + Fannie Mae Form 1076.
 * The cross-portal, no-open-API workflow HOAi/CINC structurally cannot reach.
 * Deliberately staged on a non-Vantaca AMS (Caliber/FRONTSTEPS) to make the
 * "runs on whatever each acquired company already uses" point.
 */
const ESTOPPEL: Scenario = {
  id: 'estoppel',
  label: 'Estoppel + Form 1076',
  workspace: 'Crestline Mgmt',
  agentName: 'Julius',
  recentSites: [
    { tag: 'H', name: 'HomeWiseDocs', color: '#2F6FED' },
    { tag: 'C', name: 'Caliber AMS', color: '#5B53C7' },
    { tag: 'M', name: 'Inbox', color: '#E2574C' },
    { tag: 'B', name: 'Bank', color: '#1F7A4D' },
    { tag: 'G', name: 'Google', color: '#4285F4' },
  ],
  surfaces: {
    H: {
      tag: 'H',
      name: 'HomeWiseDocs — Resale & Estoppel Orders',
      color: '#2F6FED',
      sections: ['Orders', 'In Progress', 'Delivered', 'Billing'],
    },
    C: {
      tag: 'C',
      name: 'Caliber by FRONTSTEPS — Owner Ledger (AMS)',
      color: '#5B53C7',
      sections: ['Owners', 'Ledger', 'Compliance', 'Documents'],
    },
    M: {
      tag: 'M',
      name: 'Inbox — Manager approval',
      color: '#E2574C',
      sections: ['Inbox', 'Sent', 'Approvals'],
    },
  },
  toolCount: 3,
  userMsg:
    'Hey Julius — a title company just ordered a resale package and a lender questionnaire for 1442 Marigold Way. Let me show you how we turn one of these around, so you can take them next time.',
  replyFull:
    'Happy to learn this one — estoppels are all deadline. Let me pull up the recording interface. Walk me through it exactly how you do it today, across whatever systems you use, and I’ll watch and learn.',
  rec: [
    {
      surface: 'H',
      crumb: 'Orders › #HW-88231',
      title: 'Picked up the resale/estoppel order',
      detail: '1442 Marigold Way · resale package + Fannie Mae 1076',
      say: 'A title company just ordered a resale package and a 1076 for a closing — the clock starts now.',
    },
    {
      surface: 'H',
      crumb: 'Orders › Deadline',
      title: 'Logged the statutory deadline',
      detail: '10 business days · due Jul 2 · fee $250',
      say: 'By law we have ten business days, so the first thing I do is lock the deadline.',
    },
    {
      surface: 'C',
      crumb: 'Owners › Acct 4471',
      title: 'Opened the owner in the AMS',
      detail: 'Caliber ledger — note: not Vantaca',
      say: 'I open the homeowner in our AMS — and notice this is Caliber, not Vantaca.',
    },
    {
      surface: 'C',
      crumb: 'Ledger › Balance',
      title: 'Pulled the ledger balance, dues & transfer fee',
      detail: 'Current $0 · dues $312/qtr · transfer fee $250',
      say: 'I read the current balance, the quarterly dues, and the transfer fee.',
    },
    {
      surface: 'C',
      crumb: 'Compliance › Status',
      title: 'Checked violations & special assessments',
      detail: 'No open violations · 1 active special assessment $1,200',
      say: 'Then open violations and assessments — there’s an active assessment we have to disclose.',
    },
    {
      surface: 'C',
      crumb: 'Documents › Insurance',
      title: 'Pulled insurance & reserves for the 1076',
      detail: 'Master policy + $410k reserves + fidelity bond on file',
      say: "For the lender's 1076 I grab the master insurance, the reserves, and the fidelity bond.",
    },
    {
      surface: 'H',
      crumb: 'Order › Fill',
      title: 'Filled the estoppel certificate & Form 1076',
      detail: 'Every field populated from the ledger + documents',
      say: 'Now I fill the estoppel cert and the 1076 from everything I just pulled — no retyping.',
    },
    {
      surface: 'M',
      crumb: 'To: Community Manager',
      title: 'Sent it to the manager to review & e-sign',
      detail: 'Manager review · e-signature requested',
      say: 'Nothing goes out unsigned — I route the package to the manager to approve and sign.',
    },
    {
      surface: 'H',
      crumb: 'Order › Deliver',
      title: 'Delivered the package & invoiced the fee',
      detail: 'Uploaded to HomeWiseDocs · $250 invoiced · order closed',
      say: 'Once it’s signed I deliver it back through the portal, invoice the fee, and close the order.',
    },
  ],
  proc: [
    { text: 'Identified the trigger: a resale/estoppel order' },
    { text: 'Captured the 10-business-day statutory deadline' },
    { text: 'Saved the manager e-signature as a human approval' },
    { text: 'Mapped it across 3 systems you already use — 0 APIs, 0 keys' },
  ],
  trigger:
    'When a title company orders a resale/estoppel package or a lender questionnaire',
  steps: [
    {
      type: 'read',
      surface: 'H',
      text: 'Pick up the resale/estoppel order and log the statutory deadline',
    },
    {
      type: 'do',
      surface: 'C',
      text: 'Open the homeowner in your AMS and pull the ledger balance, dues, and transfer fee',
    },
    {
      type: 'read',
      surface: 'C',
      text: 'Read open violations and any active special assessments to disclose',
    },
    {
      type: 'do',
      surface: 'C',
      text: 'Pull the master insurance, reserves, and fidelity bond for the lender’s Form 1076',
    },
    {
      type: 'branch',
      surface: 'C',
      text: 'Check the account status',
      sub: 'If the owner is delinquent → add the payoff figure and late fees to the certificate. If current → continue.',
    },
    {
      type: 'human',
      surface: 'M',
      text: 'Send the completed estoppel certificate + Form 1076 to the manager to review and e-sign',
      sub: 'Human checkpoint — nothing is delivered until the manager signs.',
    },
    {
      type: 'do',
      surface: 'H',
      text: 'Deliver the signed package back through the order portal, invoice the fee, and close the order',
    },
  ],
  exception:
    'If the 10-business-day deadline is within 48 hours and anything’s missing, flag the manager now — a late estoppel can forfeit the HOA’s fee.',
  lockNote:
    'Julius works across HomeWiseDocs, your AMS, and email by driving them like you do — even though none of them share an API.',
  saved: {
    agentTitle: 'Estoppel & 1076 Runner',
    watching: 'HomeWiseDocs — new resale/estoppel orders',
    cadence: 'Runs on every new order, the moment it lands',
    guard: 'Always pauses for the manager’s e-signature before delivery',
    metric: 'Industry avg issuance ~12.6 days → prepared in minutes',
  },
}

export const SCENARIOS: Record<ScenarioId, Scenario> = {
  maintenance: MAINTENANCE,
  estoppel: ESTOPPEL,
}

export const SCENARIO_ORDER: ScenarioId[] = ['maintenance', 'estoppel']

export function getScenario(id: string | null | undefined): Scenario {
  if (id === 'estoppel' || id === 'maintenance') return SCENARIOS[id]
  return MAINTENANCE
}
