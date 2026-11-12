# Email information and sharing — exploration, not a selected design

Status: the clarification below separates decided behavior from open options. Do not implement collection, recovery email or app-sent notifications from this note. This work is for review, not automatic merge or deployment.

## Decided

- Members enter their own phone number and email address as their own information. This is not permission to upload an imported department contact list. This clarification does not settle which fields must be completed during joining.
- Sign-in uses a passkey, with no email address typed at sign-in and no Department Hub password. An email field elsewhere is compatible with that decision. The older blanket wording that the app must not require or collect email was incorrect.
- Do not build app-sent email or text messages. Leave the current Share action in place: the person chooses their own app and recipient through the phone's share sheet or the existing email/text fallback.
- Sharing a post transfers that post and its selected files, not the directory. Do not attach coworker contact records, populate recipients from them or transmit a coworker's address as share metadata.

## Open: what the email information is for

Neither candidate is selected. Do not treat the contact-email test contract as choosing one.

| Candidate | What it would mean | What would still need deciding |
| --- | --- | --- |
| Contact information, like the phone number | Optional; private by default; the member chooses sharing and can withdraw it. Withheld addresses stay out of coworkers' directory, direct lookups, search, Ask and exports, with no ordinary administrator/custodian exception. The owner can inspect their own value. | Whether to adopt this use, when to collect it and how to explain its sharing control. |
| Administrator-only identity-confirmation channel before recovery | Never in the directory; available only to the two administrators for this purpose. The person requesting recovery cannot edit the address used to confirm that recovery. | Whether to adopt this use, how the address is initially established and how legitimate corrections are maintained. No confirmation, maintenance or sending mechanism is designed here. |
| Both | Two separate fields with different purposes and access/update rules. Choosing contact sharing must not publish or overwrite the recovery channel, and changing the contact field must not redirect recovery. | Whether to adopt both and the separate rules for each. One field with two meanings is not an implementation shortcut. |

The existing known-channel recovery proposal does not select email as that channel. It must be reconciled with the selected email option before implementation.

## Open: app-sent notifications

No delivery mechanism is selected or designed. An email/text sending service would add operating costs, potentially a paid provider, and a sending domain to manage. Hospital mail filters may treat a new sender as spam; delivery cannot be assumed. More fundamentally, sending changes the experience from an app people open into an app that contacts them. Who wants those interruptions, for what events, and whether a text plus an email would duplicate the same notice remain questions. Recording these costs does not authorize sending or buying a service/domain.

## Candidate contract, not a product choice

`tests/shared/email-contact.test.mjs` is a preventive HTTP contract for the **contact-information candidate**. It runs separately from the current permission gate, against real synthetic backend sessions only. It requires actual shared-address positive controls and private/default-private/withdrawal checks; hiding every address cannot pass. The fixture names `email` and `shareEmail` describe that candidate test interface, not a selected production schema. No recovery-email field or administrator recovery endpoint is chosen by those tests.

If contact email is selected, this contract must pass before that feature is enabled, alongside the existing permission gate. If administrator-only email is selected instead, its distinct access/update contract must be written and passed before use; directory-sharing positives must not be repurposed as permission to publish it. If both are selected, both contracts are required on separate fields. Neither a backend nor either email feature exists today, and no email is being collected by this change.
