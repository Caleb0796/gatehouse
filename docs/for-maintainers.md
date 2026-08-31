# Gatehouse integration for maintainers

Add this field to the repository's GitHub issue form:

```yaml
- type: textarea
  id: gatehouse_receipt_url
  attributes:
    label: Gatehouse receipt URL
    description: "Paste the complete Gatehouse receipt URL, including the #a= fragment, so maintainers can inspect the browser-recorded evidence, its unauthenticated local approval, and the reproduction hash. This approval does not verify identity and is not a cryptographic signature; automation can activate it."
    placeholder: "https://gatehouse.example/receipt.html#a=..."
  validations:
    required: true
```

If Gatehouse reports that the receipt exceeds the link budget, attach the downloaded Gatehouse v2 JSON receipt instead. A maintainer can open `receipt.html` and use **Import receipt JSON** to inspect it.

For an issue submitted without a receipt, a bot can reply:

> Thanks for the report. We cannot inspect the browser-recorded Gatehouse evidence because this issue does not include a receipt URL. Please run the repro through Gatehouse, record local approval, then paste the complete receipt URL—including the `#a=...` fragment—into the **Gatehouse receipt URL** field, or attach the downloaded Gatehouse v2 JSON receipt when Gatehouse offers that fallback. Local approval is unauthenticated, does not verify identity, is not a cryptographic signature, and can be activated by automation.
