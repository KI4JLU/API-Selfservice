# Admin: Cost centers

## Lookup

The lookup is the list of all known cost centers with status `pending`, `approved`, `rejected` or `archived`.

- **Create cost center**: number (8 digits), name, owner and optionally a max budget with period. Newly created cost centers are approved immediately.
- **Owner**: search the LiteLLM users by e-mail or user ID. The owner automatically becomes cost center admin and stays admin while they are the owner. Older cost centers without a linked LiteLLM user show **Owner missing**; pick one under **Edit**.
- **Edit**: change name, owner, max budget and **released models**. A new owner becomes cost center admin; the previous owner stays admin until you demote them.
- **Released models**: without a selection all models are released. With a selection, key creation only offers these models and LiteLLM only allows them for the cost center's team. Paid models stay unavailable on the default cost center.
- **Members**: manage members and cost center admins of the cost center as described under **My cost centers**. Admins may also remove the last cost center admin.
- **Archive**: the cost center can no longer be chosen for new keys; existing references in reports are kept. Deletion is not supported.
- The default cost center `1111 1111` is always approved and can neither be edited nor archived.

## Requests

Requests from users for new cost centers are listed here.

- **Approve**: the cost center becomes `approved` and is assigned to the user immediately. The owner named in the request (a LiteLLM user) becomes cost center admin, the requester a member.
- **Reject**: with a reason.

In both cases the user is informed by e-mail.
