# Deployment Handbook

# Azure AI Foundry Deployment Types, GDPR Positioning, EU AI Act Risk Levels & Model Selection

## Purpose of this handbook

This document explains how Azure AI Foundry / Azure OpenAI deployments should be selected for European customers, especially where GDPR, EU data residency, customer risk profile, and the EU AI Act are relevant.

It is structured in two parts:

1. **Business Guideline** – for management, sales, compliance, and customer stakeholders
2. **Technical Appendix** – for architects, developers, and implementation teams

***

# Part 1 — Business Guideline

## 1. Executive Summary

Azure AI Foundry offers different deployment types for AI models. These deployment types mainly determine:

* where AI inference processing can take place,
* how capacity is billed,
* how predictable performance is,
* how strong the data residency position is.

Microsoft distinguishes between **Global**, **Data Zone**, and **Regional** deployment types. Global deployments may process inference in any Azure region, Data Zone deployments process within a defined zone such as the EU or US, and Regional deployments process only in the selected Azure region. [\[learn.microsoft.com\]](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/deployment-types), [\[learn.microsoft.com\]](https://learn.microsoft.com/en-us/answers/questions/5533591/azure-ai-model-deployment-types)

For European customers, the most important practical recommendation is:

| Customer Type                              |                        Recommended Deployment | Reason                                                           |
| ------------------------------------------ | --------------------------------------------: | ---------------------------------------------------------------- |
| Normal SME / commercial customer           |                     **Data Zone Standard EU** | Good GDPR position, good availability, balanced cost             |
| Enterprise customer with stable/high usage |                  **Data Zone Provisioned EU** | EU processing plus predictable performance                       |
| Highly regulated customer                  | **Regional Standard or Regional Provisioned** | Strongest data residency and audit position                      |
| Low-risk internal experimentation          |                           **Global Standard** | Good model access and scalability, but weaker residency position |

For most European business use cases, **Data Zone Standard EU in Sweden Central** is a strong default choice. It keeps processing within the EU Data Zone while maintaining better availability and model access than stricter single-region deployments. [\[learn.microsoft.com\]](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/deployment-types), [\[learn.microsoft.com\]](https://learn.microsoft.com/en-us/answers/questions/5630048/azure-openai-deployments-difference-between-data-z)

***

## 2. Core Concepts Explained in Simple Terms

## 2.1 What is a deployment type?

A deployment type defines **where and how an AI model is run**.

When an AI model receives a prompt, the prompt must be processed somewhere. The Azure deployment type controls whether this processing can happen:

* globally,
* inside an EU/US data zone,
* or only in one specific Azure region.

| Deployment Type        | Simple Explanation                                         | Data Residency Strength |
| ---------------------- | ---------------------------------------------------------- | ----------------------: |
| **Global Standard**    | AI processing may happen in any Azure region worldwide     |                  Medium |
| **Data Zone Standard** | AI processing stays inside the selected data zone, e.g. EU |                  Strong |
| **Regional Standard**  | AI processing stays inside one selected Azure region       |               Strongest |

Microsoft states that data at rest remains in the designated Azure geography, but inference processing depends on the deployment type: Global may process in any Azure region, Data Zone within the selected data zone, and Regional within the selected region. [\[learn.microsoft.com\]](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/deployment-types), [\[learn.microsoft.com\]](https://learn.microsoft.com/en-us/answers/questions/5533591/azure-ai-model-deployment-types)

***

## 2.2 What does “throughput” mean?

**Throughput** means how much AI workload can be processed in a given time.

A simple analogy:

| Scenario               | Analogy               |
| ---------------------- | --------------------- |
| Low throughput         | One-lane road         |
| High throughput        | Multi-lane highway    |
| Provisioned throughput | Reserved private lane |

If only a few users ask questions occasionally, normal **Standard** deployments are usually sufficient.

If hundreds or thousands of users use the AI system at the same time, predictable throughput becomes important. In that case, **Provisioned Throughput** may be required.

***

## 2.3 What is Provisioned Throughput?

**Provisioned Throughput** means reserved AI processing capacity.

Instead of using shared pay-as-you-go capacity, the customer reserves dedicated capacity. Microsoft refers to this as **Provisioned Throughput Units**, often abbreviated as **PTUs**. [\[learn.microsoft.com\]](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/deployment-types)

| Deployment Type | Meaning                                    | Best For                        |
| --------------- | ------------------------------------------ | ------------------------------- |
| Standard        | Shared capacity, pay per token             | Normal business use             |
| Provisioned     | Reserved capacity, predictable performance | Enterprise production workloads |
| Batch           | Asynchronous bulk processing               | Large offline workloads         |

Provisioned deployments are useful when the customer needs predictable latency, stable performance, and higher reliability for business-critical workloads. [\[learn.microsoft.com\]](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/deployment-types)

***

## 2.4 What is Batch?

**Batch** means that requests are processed asynchronously.

Instead of a user asking a question and expecting an immediate answer, a batch job submits many requests at once and receives the results later.

Example:

| Interactive AI            | Batch AI                             |
| ------------------------- | ------------------------------------ |
| Chatbot answer in seconds | 50,000 documents processed overnight |
| User waits for response   | System waits for job completion      |
| Real-time use             | Offline processing                   |

Batch deployments are usually suitable for:

* document classification,
* data enrichment,
* large-scale summarisation,
* invoice or contract processing,
* offline knowledge base preparation.

Microsoft offers Global Batch and Data Zone Batch deployment options. Global Batch can process globally, while Data Zone Batch restricts processing to the selected data zone. [\[learn.microsoft.com\]](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/deployment-types)

***

# 3. GDPR and Data Residency Guidance

## 3.1 Is Global Standard automatically non-GDPR-compliant?

Not necessarily.

A Global Standard deployment can still be used in a GDPR-compliant system if appropriate legal, contractual, technical, and organisational safeguards are in place. However, from a data residency and customer trust perspective, it is harder to explain because inference processing may happen outside Europe. Microsoft states that Global deployment types may process inference in any Azure region. [\[learn.microsoft.com\]](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/deployment-types), [\[learn.microsoft.com\]](https://learn.microsoft.com/en-us/answers/questions/5533591/azure-ai-model-deployment-types)

Therefore:

| Question                                                      | Answer                                               |
| ------------------------------------------------------------- | ---------------------------------------------------- |
| Can Global Standard be used in a GDPR-compliant architecture? | Yes, possibly, depending on safeguards and data type |
| Is it the safest default for EU customers?                    | No                                                   |
| Is it recommended for sensitive or regulated data?            | Usually no                                           |
| Is it useful for low-risk, non-sensitive workloads?           | Yes                                                  |

***

## 3.2 Recommended GDPR posture

| Deployment Type       | GDPR Position                          | Customer Communication                             |
| --------------------- | -------------------------------------- | -------------------------------------------------- |
| Global Standard       | Possible but requires more explanation | “Processing may occur globally.”                   |
| Data Zone Standard EU | Strong                                 | “Processing remains within the EU Data Zone.”      |
| Regional Standard     | Strongest                              | “Processing remains in the selected Azure region.” |

For most European business customers, **Data Zone Standard EU** is the best balance between compliance, model availability, cost, and scalability. [\[learn.microsoft.com\]](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/deployment-types), [\[learn.microsoft.com\]](https://learn.microsoft.com/en-us/answers/questions/5630048/azure-openai-deployments-difference-between-data-z)

***

# 4. Sweden Central vs Germany West Central

## 4.1 Sweden Central

Sweden Central is a strong Azure region for European AI workloads and is commonly used for Azure OpenAI / Foundry deployments. It is frequently listed among EU regions where modern GPT models are available. [\[requesty.ai\]](https://www.requesty.ai/eu/openai), [\[jinlee794.github.io\]](https://jinlee794.github.io/foundry-model-availability-notifications/models/gpt-5/)

| Strength                                         | Explanation                                     |
| ------------------------------------------------ | ----------------------------------------------- |
| Good GPT model availability                      | Many GPT models are available in Sweden Central |
| Strong EU data residency story                   | Suitable for EU Data Zone deployments           |
| Good default for European SaaS and SME workloads | Balanced availability and compliance            |
| Strong option for AI assistants and copilots     | Practical default for commercial solutions      |

Recommended use:

* AI assistants,
* internal copilots,
* sales copilots,
* RAG systems,
* knowledge assistants,
* SME automation,
* general European business AI workloads.

***

## 4.2 Germany West Central

Germany West Central is often preferred by German customers or customers with stricter expectations around German or EU data residency. It may be especially relevant for conservative industries.

| Strength                          | Explanation                                     |
| --------------------------------- | ----------------------------------------------- |
| Strong customer trust in Germany  | Often easier to position for German enterprises |
| Good option for regulated buyers  | Useful for conservative compliance environments |
| Suitable for regional deployments | Strong data residency position                  |

Recommended use:

* German healthcare,
* German public sector,
* banking,
* insurance,
* legal,
* highly regulated enterprise environments.

***

# 5. EU AI Act Explained

## 5.1 What is the EU AI Act?

The EU AI Act is a European regulation that introduces a risk-based framework for AI systems. The core principle is simple:

> The higher the potential impact on people’s rights, safety, livelihood, or access to essential services, the stricter the obligations.

The EU AI Act uses a risk-based model with four broad categories:

1. **Unacceptable risk**
2. **High risk**
3. **Limited risk**
4. **Minimal risk**

This classification is separate from Azure deployment types. The EU AI Act determines the legal obligations for the AI use case. Azure deployment types determine where and how the model is technically processed.

***

## 5.2 The four AI Act risk levels

| Risk Level        | Meaning                                                                                     | Typical Obligation                                                 |
| ----------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Unacceptable Risk | AI use cases that are prohibited                                                            | Do not implement                                                   |
| High Risk         | AI systems that can significantly affect people’s rights or life opportunities              | Strict governance, documentation, risk management, human oversight |
| Limited Risk      | AI systems that interact with people or generate content but do not make critical decisions | Transparency obligations                                           |
| Minimal Risk      | Low-impact AI systems                                                                       | Light or no specific AI Act obligations                            |

***

# 6. Mapping EU AI Act Risk Levels to Customer Types

## 6.1 Risk Level 1 — Unacceptable Risk

These are AI use cases that should not be implemented.

Examples may include:

* social scoring,
* manipulative AI exploiting vulnerable people,
* prohibited biometric surveillance scenarios,
* systems that violate fundamental rights.

| Customer Type   | Recommendation                           |
| --------------- | ---------------------------------------- |
| Any customer    | Do not implement                         |
| Public sector   | Extreme caution                          |
| Private company | Reject project if use case is prohibited |

Business rule:

> If the use case falls into an unacceptable risk category, the project should not proceed.

***

## 6.2 Risk Level 2 — High Risk

High-risk systems are not automatically forbidden, but they require strict governance.

Typical areas include:

* employment,
* worker evaluation,
* recruitment,
* education access,
* credit scoring,
* insurance eligibility,
* healthcare,
* critical infrastructure,
* public administration,
* law enforcement-related use cases.

| Customer Type                    | Example Use Case                           | Risk Level |
| -------------------------------- | ------------------------------------------ | ---------: |
| Healthcare provider              | AI-supported diagnosis or triage           |       High |
| Bank                             | Creditworthiness assessment                |       High |
| Insurance company                | Eligibility or premium decisioning         |       High |
| Employer / HR provider           | Candidate screening or employee evaluation |       High |
| University                       | Student admission ranking                  |       High |
| Government agency                | Citizen eligibility decisions              |       High |
| Critical infrastructure operator | Safety-related operational decisions       |       High |

Recommended Azure posture:

| Area            | Recommendation                                               |
| --------------- | ------------------------------------------------------------ |
| Deployment type | Regional Standard or Regional Provisioned                    |
| Region          | Germany West Central or Sweden Central                       |
| Model           | Strong model such as GPT-5 family, depending on availability |
| Logging         | Full audit trail                                             |
| Human oversight | Required                                                     |
| Documentation   | Required                                                     |
| Risk assessment | Required                                                     |
| DPIA            | Strongly recommended or required depending on processing     |

Business rule:

> For high-risk AI Act use cases, use the strongest technical governance and data residency position available.

***

## 6.3 Risk Level 3 — Limited Risk

Limited-risk systems usually interact with users but do not make critical decisions about them.

Examples:

* customer service chatbot,
* website chatbot,
* internal assistant,
* sales copilot,
* knowledge assistant,
* meeting summariser,
* content generation assistant.

| Customer Type         | Example Use Case             | Risk Level |
| --------------------- | ---------------------------- | ---------: |
| SME                   | Customer chatbot             |    Limited |
| Consulting company    | Internal knowledge assistant |    Limited |
| Manufacturing company | Maintenance knowledge bot    |    Limited |
| Retail company        | Product support assistant    |    Limited |
| SaaS company          | AI helpdesk assistant        |    Limited |
| Sales organisation    | CRM follow-up assistant      |    Limited |

Recommended Azure posture:

| Area              | Recommendation                     |
| ----------------- | ---------------------------------- |
| Deployment type   | Data Zone Standard EU              |
| Region            | Sweden Central                     |
| Model             | GPT-5 Mini or GPT-5                |
| User transparency | Inform users they interact with AI |
| Logging           | Recommended                        |
| Human escalation  | Recommended                        |

Business rule:

> For most normal business AI assistants, Data Zone Standard EU is the best default.

***

## 6.4 Risk Level 4 — Minimal Risk

Minimal-risk systems have low impact on people and usually support productivity or automation.

Examples:

* grammar correction,
* translation,
* spam filtering,
* search,
* internal document tagging,
* summarisation of non-sensitive documents,
* internal productivity automation.

| Customer Type | Example Use Case       |         Risk Level |
| ------------- | ---------------------- | -----------------: |
| Any business  | Internal summarisation |            Minimal |
| Any business  | Translation            |            Minimal |
| Any business  | Meeting transcription  | Minimal to Limited |
| Any business  | Document tagging       |            Minimal |
| Any business  | Search assistant       |            Minimal |

Recommended Azure posture:

| Area            | Recommendation                                                  |
| --------------- | --------------------------------------------------------------- |
| Deployment type | Global Standard, Data Zone Standard, or Regional                |
| Region          | Sweden Central for EU-first posture                             |
| Model           | GPT-5 Mini, GPT-5 Nano, GPT-4.1 Mini, depending on availability |
| Governance      | Basic AI usage policy                                           |
| Logging         | Optional but recommended                                        |

Business rule:

> Minimal-risk AI systems can use more flexible deployment types, but Data Zone EU is still the preferred default for European customers.

***

# 7. Business Decision Matrix

## 7.1 Recommended deployment by customer category

| Customer Category    |                 Typical Risk | Recommended Deployment               | Explanation                                       |
| -------------------- | ---------------------------: | ------------------------------------ | ------------------------------------------------- |
| Small business / SME |           Minimal to Limited | Data Zone Standard EU                | Good GDPR position and manageable cost            |
| Consulting / agency  |                      Limited | Data Zone Standard EU                | Good for copilots, RAG, sales assistants          |
| Manufacturing        |                      Limited | Data Zone Standard EU                | Suitable for operations and knowledge assistants  |
| Retail / e-commerce  |                      Limited | Data Zone Standard EU                | Suitable for support bots and product assistants  |
| SaaS company         |              Limited to High | Data Zone Standard EU or Provisioned | Depends on scale and customer data sensitivity    |
| Enterprise           |              Limited to High | Data Zone Provisioned EU             | Predictable performance and EU processing         |
| Healthcare           |                         High | Regional Standard / Provisioned      | Strongest residency and governance position       |
| Banking              |                         High | Regional Standard / Provisioned      | Strong audit and compliance posture               |
| Insurance            |                         High | Regional Standard / Provisioned      | Needed for sensitive decisioning                  |
| Government           |                         High | Regional Standard / Provisioned      | Strongest data residency position                 |
| Education            |              Limited to High | Data Zone or Regional                | Depends whether AI affects student access/results |
| HR / recruitment     | High if screening candidates | Regional Standard / Provisioned      | High-risk AI Act area                             |

***

## 7.2 Recommended deployment by use case

| Use Case                              |        AI Act Risk | Recommended Deployment          |
| ------------------------------------- | -----------------: | ------------------------------- |
| Internal knowledge assistant          |            Limited | Data Zone Standard EU           |
| Sales follow-up assistant             |            Limited | Data Zone Standard EU           |
| Meeting summarisation                 | Minimal to Limited | Data Zone Standard EU           |
| Customer chatbot                      |            Limited | Data Zone Standard EU           |
| Document summarisation                | Minimal to Limited | Data Zone Standard EU           |
| Contract analysis                     |    Limited to High | Data Zone EU or Regional        |
| Medical triage                        |               High | Regional                        |
| Credit scoring                        |               High | Regional                        |
| Insurance eligibility                 |               High | Regional                        |
| Candidate screening                   |               High | Regional                        |
| Government eligibility assessment     |               High | Regional                        |
| Large offline document classification | Minimal to Limited | Data Zone Batch                 |
| Large non-sensitive batch enrichment  |            Minimal | Global Batch or Data Zone Batch |

***

# 8. Recommended Customer-Facing Policy Statement

The following wording can be reused in proposals or project documentation:

> For European customer deployments, we recommend Azure AI Foundry deployments using EU-based data residency controls. For most business AI assistants, copilots, search, summarisation, and knowledge-management use cases, we recommend **Data Zone Standard EU**, preferably deployed from an EU Azure region such as Sweden Central. This ensures that inference processing remains within the EU Data Zone while maintaining good model availability, performance, and cost efficiency.
>
> For highly regulated customers or AI Act high-risk use cases, such as healthcare, credit scoring, insurance eligibility, employment screening, or public-sector decision systems, we recommend **Regional deployments** to provide the strongest data residency and audit position.
>
> The selected deployment type should always be aligned with the sensitivity of the processed data, the customer’s industry, the AI Act risk level, and the required contractual compliance posture.

***

# Part 2 — Technical Appendix

# 9. Azure AI Foundry Deployment Types

Azure AI Foundry deployment types combine two dimensions:

1. **Data processing location**
2. **Capacity and billing model**

***

## 9.1 Data processing location

| Type      | Processing Location   | Technical Meaning                               | Compliance Position            |
| --------- | --------------------- | ----------------------------------------------- | ------------------------------ |
| Global    | Any Azure region      | Microsoft may route inference globally          | Flexible, but weaker residency |
| Data Zone | EU or US data zone    | Inference remains inside the selected data zone | Strong EU posture              |
| Regional  | Specific Azure region | Inference remains in the selected region        | Strongest residency            |

Microsoft’s deployment documentation describes Global, Data Zone, and Regional deployment types and clarifies that inference data processing depends on the selected deployment type. [\[learn.microsoft.com\]](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/deployment-types), [\[learn.microsoft.com\]](https://learn.microsoft.com/en-us/answers/questions/5533591/azure-ai-model-deployment-types)

***

## 9.2 Capacity and billing model

| Type        | Billing                     |          Latency | Best For                      |
| ----------- | --------------------------- | ---------------: | ----------------------------- |
| Standard    | Pay per token               |         Variable | Normal interactive AI         |
| Provisioned | Reserved PTU capacity       | More predictable | Production enterprise systems |
| Batch       | Async discounted processing |    Not real-time | Large offline jobs            |

***

## 9.3 Full deployment type overview

| Deployment Type       | Data Processing     | Billing Model       | Best For                                   |
| --------------------- | ------------------- | ------------------- | ------------------------------------------ |
| Global Standard       | Any Azure region    | Pay per token       | General workloads, broad availability      |
| Global Provisioned    | Any Azure region    | Reserved throughput | High-volume global systems                 |
| Global Batch          | Any Azure region    | Batch pricing       | Large async jobs without strict residency  |
| Data Zone Standard    | EU/US data zone     | Pay per token       | GDPR-conscious business workloads          |
| Data Zone Provisioned | EU/US data zone     | Reserved throughput | Enterprise workloads needing EU processing |
| Data Zone Batch       | EU/US data zone     | Batch pricing       | Large async jobs with EU processing        |
| Regional Standard     | Single Azure region | Pay per token       | Strong residency, lower volume             |
| Regional Provisioned  | Single Azure region | Reserved throughput | Regulated production workloads             |

***

# 10. Azure Deployment Selection Logic

## 10.1 Default technical recommendation

For most European commercial customers:

```text
Azure Region: Sweden Central
Deployment Type: Data Zone Standard EU
Model: GPT-5 Mini or GPT-5
```

Rationale:

* EU inference processing,
* good model availability,
* efficient cost,
* suitable for most copilots and business assistants,
* easier GDPR explanation than Global deployments.

***

## 10.2 Enterprise recommendation

For enterprise workloads with higher load:

```text
Azure Region: Sweden Central
Deployment Type: Data Zone Provisioned EU
Model: GPT-5
Capacity Model: Provisioned Throughput Units
```

Rationale:

* EU data zone processing,
* predictable performance,
* better for production SLAs,
* suitable for customer-facing systems.

***

## 10.3 Regulated industry recommendation

For high-risk or highly regulated workloads:

```text
Azure Region: Germany West Central or Sweden Central
Deployment Type: Regional Standard or Regional Provisioned
Model: GPT-5 family, depending on availability
```

Rationale:

* strongest residency control,
* clearer audit position,
* better for AI Act high-risk use cases,
* better for conservative procurement reviews.

***

# 11. Model Families and Recommended Usage

The most relevant model families for chat, assistants, agent workflows, and multimodal use cases are the GPT-5 family, GPT-5 Mini/Nano variants, and GPT-4.1 / GPT-4o Mini models where available. Current third-party Azure availability trackers list models such as GPT-5, GPT-5 Mini, GPT-5 Nano, GPT-4.1, GPT-4.1 Mini, GPT-4.1 Nano, and GPT-4o Mini across EU Azure regions including Sweden Central, France Central, UK South, and Germany West Central depending on model and SKU. [\[requesty.ai\]](https://www.requesty.ai/eu/openai), [\[jinlee794.github.io\]](https://jinlee794.github.io/foundry-model-availability-notifications/models/gpt-5/)

## 11.1 Model comparison

| Model        | Best For                                              | Strength                                |     Cost Level | Typical Deployment                 |
| ------------ | ----------------------------------------------------- | --------------------------------------- | -------------: | ---------------------------------- |
| GPT-5.5      | Premium reasoning, strategy, complex analysis         | Highest capability                      |      Very high | Data Zone or Regional if available |
| GPT-5        | Enterprise assistants, RAG, complex chat, agents      | Strong reasoning and general capability |           High | Data Zone Standard / Provisioned   |
| GPT-5 Mini   | Customer support, sales assistants, internal copilots | Good balance of quality and cost        |         Medium | Data Zone Standard                 |
| GPT-5 Nano   | Lightweight automation, classification, simple tasks  | Very cost-efficient                     |            Low | Data Zone or Global                |
| GPT-4.1      | Long-context analysis, structured reasoning           | Strong long-context support             | Medium to high | Data Zone or Regional              |
| GPT-4.1 Mini | Cost-effective chat and workflow automation           | Good price/performance                  |         Medium | Data Zone Standard                 |
| GPT-4o Mini  | Lightweight multimodal/chat workloads                 | Fast and affordable                     |            Low | Data Zone or Global                |

***

## 11.2 Recommended model by use case

| Use Case                    | Recommended Model                                                 | Alternative  |
| --------------------------- | ----------------------------------------------------------------- | ------------ |
| Executive assistant         | GPT-5                                                             | GPT-5 Mini   |
| Customer service bot        | GPT-5 Mini                                                        | GPT-4.1 Mini |
| Sales follow-up agent       | GPT-5 Mini                                                        | GPT-5        |
| RAG knowledge assistant     | GPT-5                                                             | GPT-5 Mini   |
| Legal or strategic analysis | GPT-5.5 or GPT-5                                                  | GPT-4.1      |
| Classification              | GPT-5 Nano                                                        | GPT-4.1 Nano |
| Summarisation               | GPT-5 Mini                                                        | GPT-4o Mini  |
| Vision-enabled assistant    | GPT-5 or GPT-5 Mini if vision is supported in selected deployment | GPT-4o Mini  |
| High-volume automation      | GPT-5 Mini or GPT-5 Nano                                          | GPT-4.1 Mini |

***

# 12. Sweden Central Model Strategy

## 12.1 Why Sweden Central is a strong default

Sweden Central is a practical default region for EU-based Azure AI projects because relevant GPT models are commonly available there and it supports EU-focused deployment strategies. Availability references list Sweden Central for several GPT model families and deployment options. [\[requesty.ai\]](https://www.requesty.ai/eu/openai), [\[jinlee794.github.io\]](https://jinlee794.github.io/foundry-model-availability-notifications/models/gpt-5/)

| Requirement                          |                 Sweden Central Fit |
| ------------------------------------ | ---------------------------------: |
| EU customer projects                 |                             Strong |
| Data Zone Standard EU                |                             Strong |
| GPT model availability               |                             Strong |
| SME and mid-market AI use cases      |                             Strong |
| Regulated German customer perception | Good, but Germany may be preferred |
| Strict single-country residency      |    Depends on customer requirement |

***

## 12.2 When to use Germany instead

Use Germany West Central when:

* the client explicitly requests Germany,
* the client is in a highly regulated German industry,
* the procurement team prefers German data residency,
* the use case is high-risk under the EU AI Act,
* the customer’s internal compliance policy requires Germany.

***

# 13. Deployment Type and AI Act Mapping

## 13.1 Technical mapping

| AI Act Risk Level | Technical Deployment Recommendation       | Reason                              |
| ----------------- | ----------------------------------------- | ----------------------------------- |
| Unacceptable      | No deployment                             | Prohibited use case                 |
| High Risk         | Regional Standard or Regional Provisioned | Strongest control and auditability  |
| Limited Risk      | Data Zone Standard EU                     | Strong compliance balance           |
| Minimal Risk      | Data Zone Standard or Global Standard     | Depends on sensitivity and contract |

***

## 13.2 Governance requirements by risk level

| Risk Level   |     Logging | Human Oversight | Documentation | Regional Deployment Needed? |
| ------------ | ----------: | --------------: | ------------: | --------------------------: |
| Unacceptable |         N/A |             N/A |           N/A |            Do not implement |
| High Risk    |    Required |        Required |      Required |                 Recommended |
| Limited Risk | Recommended |     Recommended |   Recommended |                 Not usually |
| Minimal Risk |    Optional |        Optional |         Basic |                          No |

***

# 14. Practical Implementation Checklist

## 14.1 Customer assessment checklist

Before selecting a deployment type, answer:

| Question                                                                         | Why It Matters                                     |
| -------------------------------------------------------------------------------- | -------------------------------------------------- |
| Is the customer located in the EU?                                               | Determines GDPR and EU data residency expectations |
| Is personal data processed?                                                      | GDPR relevance                                     |
| Is sensitive personal data processed?                                            | Higher risk                                        |
| Does the AI system affect people’s rights or opportunities?                      | EU AI Act classification                           |
| Is the customer in healthcare, banking, insurance, HR, education, or government? | Possible high-risk category                        |
| Does the customer require EU-only processing?                                    | Use Data Zone EU                                   |
| Does the customer require single-region processing?                              | Use Regional                                       |
| Is the workload real-time?                                                       | Use Standard or Provisioned                        |
| Is the workload high-volume and non-real-time?                                   | Use Batch                                          |
| Is predictable performance required?                                             | Use Provisioned                                    |

***

## 14.2 Deployment decision checklist

| If Requirement Is…                      | Choose…                        |
| --------------------------------------- | ------------------------------ |
| Lowest complexity                       | Standard                       |
| Strong EU processing                    | Data Zone Standard EU          |
| Strongest data residency                | Regional Standard              |
| High volume with real-time responses    | Provisioned                    |
| High volume without real-time responses | Batch                          |
| High-risk AI Act use case               | Regional + governance controls |
| Normal SME AI assistant                 | Data Zone Standard EU          |
| Enterprise production assistant         | Data Zone Provisioned EU       |
| Non-sensitive international workload    | Global Standard                |

***

# 15. Recommended Standard Offering Structure

## 15.1 Standard SME package

```text
Region: Sweden Central
Deployment: Data Zone Standard EU
Model: GPT-5 Mini
Use cases: chatbots, knowledge assistants, sales copilots, summarisation
Risk level: Minimal to Limited
```

## 15.2 Professional enterprise package

```text
Region: Sweden Central
Deployment: Data Zone Standard EU or Data Zone Provisioned EU
Model: GPT-5
Use cases: enterprise copilots, RAG, customer support, workflow automation
Risk level: Limited to Medium sensitivity
```

## 15.3 Regulated customer package

```text
Region: Germany West Central or Sweden Central
Deployment: Regional Standard or Regional Provisioned
Model: GPT-5 family, subject to availability
Use cases: healthcare, finance, insurance, HR, public-sector decision support
Risk level: High
```

***

# 16. Short Customer Explanation

The following version can be used in emails or proposals:

> We recommend Azure AI Foundry deployments based on the sensitivity and regulatory risk of the use case. For most European business AI assistants, we use **Data Zone Standard EU**, which keeps inference processing within the EU Data Zone and provides a strong GDPR-aligned architecture.
>
> For highly regulated customers or AI Act high-risk use cases, we recommend **Regional deployments**, where processing is restricted to a specific Azure region such as Sweden Central or Germany West Central.
>
> For high-volume production systems, we may use **Provisioned Throughput**, which reserves AI processing capacity and provides more predictable performance. For large offline processing jobs, we may use **Batch**, where many requests are processed asynchronously and more cost-efficiently.

***

# 17. Final Recommendation

For most European customers:

| Scenario                          | Recommended Setup                                         |
| --------------------------------- | --------------------------------------------------------- |
| Normal business AI assistant      | Sweden Central + Data Zone Standard EU + GPT-5 Mini       |
| Stronger enterprise assistant     | Sweden Central + Data Zone Standard EU + GPT-5            |
| High-volume enterprise system     | Sweden Central + Data Zone Provisioned EU + GPT-5         |
| Regulated/high-risk AI system     | Germany West Central or Sweden Central + Regional + GPT-5 |
| Large offline document processing | Data Zone Batch EU                                        |
| Low-risk experimentation          | Global Standard, but not for sensitive customer data      |

The safest general rule:

> Use **Data Zone Standard EU** as the default for European customers.  
> Use **Regional deployments** for regulated or AI Act high-risk scenarios.  
> Use **Provisioned Throughput** when predictable performance is required.  
> Use **Batch** when processing can happen asynchronously.
