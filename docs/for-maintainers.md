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

For an issue submitted without a receipt, a bot can reply:

> Thanks for the report. We cannot inspect the browser-recorded Gatehouse evidence because this issue does not include a receipt URL. Please run the repro through Gatehouse, record local approval, then paste the complete receipt URL—including the `#a=...` fragment—into the **Gatehouse receipt URL** field. Local approval is unauthenticated, does not verify identity, is not a cryptographic signature, and can be activated by automation.
