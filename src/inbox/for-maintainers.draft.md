# For maintainers

Add this field to the repository's GitHub issue form:

```yaml
- type: textarea
  id: gatehouse_receipt
  attributes:
    label: Gatehouse receipt URL or JSON
    description: "Paste the complete receipt URL (including #a=) or drag the downloaded Gatehouse v2 JSON receipt into this field. Large receipts and browsers without compression use JSON."
    placeholder: "https://gatehouse.example/receipt.html#a=... or attach gatehouse-receipt-v2-....json"
  validations:
    required: true
```

For an issue submitted without a receipt, a bot can reply:

> Thanks for the report. We cannot replay the submitted evidence because this issue does not include a Gatehouse receipt. Please run the repro through Gatehouse, then either paste the complete receipt URL—including the `#a=...` fragment—or attach the downloaded Gatehouse v2 JSON receipt. JSON receipts can be opened with **Import receipt JSON** on the receipt page.
