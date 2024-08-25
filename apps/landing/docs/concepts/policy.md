---
title: Policy
---

## What is a policy?

In Mattrax a policy is a set of rules that define the expected state of a device. Mattrax will take care of enforcing these rules for you. <br /> A policy consists of a collection of:
 - A device configurations such as firewall rule, network setting, disk encryption configuration, taskbar/dock layout, etc
 - A script (Bash or Powershell) with a schedule to run it on


## Why would I want my policies versioned?

There is many reasons why you might want this.

<h4 class="text-xl">Ship with confidence</h4>

You can deploy changes to your fleet with the confidence that you can undo it or track it down easily. <br />
If something goes wrong with a change, you can roll back to the previous version quickly to mitigate the disruption to users. <br />
If many users are reporting issues you can check the activity feed to quickly narrow down the issue and put a stop to it.

<h4 class="text-xl">Collaboration</h4>

When working with a team of people, it's important to all be on the same page and versions help with that. <br />
You can see who made what changes and when and also leave a message on changes to provide context to your team. <br />
An activity feed on the dashboard allows everyone to keep on the same page about changes being rolled out to your fleet.

<h4 class="text-xl">Better testing</h4>

While policies are in a draft state you can quickly apply them to a test device to see the changes in action. <br />
This allows you to test changes in a real-world environment without affecting other devices or users that the policy is applied to. We also ensure the deploy is done with a high-priority because no one wants to be left wait around for the changes to apply.

## What are policy templates?

{/* TODO: Look we probally need a better name. */}

An MDM is more than just managing the operating system, it's about managing the software that runs on it. Policy templates are a way to define how to deploy, configure and licence software. Software vendors or 3rd party contributors can provide definitions that instruct Mattrax how to deploy, configure and licence their software. <br />

{/* TODO: Exmaples */}