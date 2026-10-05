# My cost centers

This screen is only available to cost center admins. It lists only the cost centers you are cost center admin of. This also applies to admins; admins see all cost centers under **Administration → Cost centers**.

## Overview

For each cost center you see number, name, owner, max budget, spend in the current period and utilization. If the budget is exhausted, the cost center is marked **blocked**: all keys of the cost center are then blocked in LiteLLM.

## Members

Each cost center is a team in LiteLLM. Only members can create API keys on the cost center. **Members** opens the list:

- **Add**: search by e-mail (at least 3 characters) or user ID. Only people LiteLLM already knows can be added, even if they never signed in to the portal. They get an e-mail; the membership applies from their first login.
- **Add several**: paste a list of e-mail addresses (separated by comma, semicolon or line break, max. 200). **Check addresses** shows who was found, which addresses belong to no LiteLLM user (copyable) and which are invalid. Found people are preselected; **Add N** adds them all at once. Only the owner and admins choose the role; otherwise everyone is added as member.
- **Role**: **Member** or **Cost center admin**. A cost center can have several admins. Only the owner (and admins) can appoint, demote or remove cost center admins; other cost center admins only add and remove members. The owner is always cost center admin (marked **Owner**) and can only be removed or demoted after an admin has set another owner.
- **Remove**: the person's keys on this cost center are blocked. Adding them again unblocks these keys.
- **Join requests**: people can ask to join via **Cost centers**. The owner and the cost center admins then get an e-mail, and a number on the **Members** button shows the open requests. At the top of the member list you see name, e-mail, time and message. **Approve**: the person becomes a member and is informed by e-mail. **Reject**: with a mandatory reason, which the person gets by e-mail.

All changes appear in the event log.

## Setting the max budget

Use **Edit** to set the max budget and the period:

- **Monthly** or **Yearly**: the budget applies per calendar month or year and resets automatically.
- **Project**: fixed budget with start and end date, no reset.
- Leave empty for unlimited.

At 80 % and 100 % of the max budget the owner and the cost center admins are informed by e-mail. A block is lifted as soon as the budget is raised or a new period starts.

## Report

**Details** opens the usage report of the cost center, broken down by users and their keys. The Excel export follows in release 2.
