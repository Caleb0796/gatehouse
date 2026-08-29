# For maintainers

Add this field to the repository's GitHub issue form:

```yaml
- type: textarea
  id: gatehouse_receipt_url
  attributes:
    label: Gatehouse receipt URL
    description: "Paste the complete Gatehouse receipt URL, including the #a= fragment, so maintainers can inspect and replay the submitted evidence."
    placeholder: "https://gatehouse.example/receipt.html#a=..."
  validations:
    required: true
```

For an issue submitted without a receipt, a bot can reply:

> Thanks for the report. We cannot replay the submitted evidence because this issue does not include a Gatehouse receipt URL. Please run the repro through Gatehouse, then paste the complete receipt URL—including the `#a=...` fragment—into the **Gatehouse receipt URL** field.
