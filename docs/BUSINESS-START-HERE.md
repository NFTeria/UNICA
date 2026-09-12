# Start here

```
make business-demo
```

That one command shows you the whole thing on a practice chain running on this computer. It takes a
few minutes and it needs nothing from you while it runs.

**TESTNET / NO VALUE.** Everything below happens on a practice chain. No real money can move on it,
and no amount you see is worth anything. Amounts are shown in uUSD, a local test dollar made up for
this demonstration. It is not USDC.

## What you will see

A barbershop called Fresh Cuts joins, says which asset it wants to be paid in, authorizes one
register, loses a tablet and revokes it, and then sells twice.

1. **A clean start.** Nothing from an earlier run is reused, so nothing you see can be left over.
2. **The business.** Its name, the wallet it joined from, the address it is paid into, the asset it
   is paid in, its registers, and its badge.
3. **Sale one.** The customer pays the very asset the business is paid in. Nothing is converted. The
   business receives exactly the amount it asked for, to the unit.
4. **Sale two.** The customer pays a different asset. It is converted during the payment, and the
   business is paid in the asset it chose. It never holds the asset the customer used.
5. **Both receipts.** Each sale is read back from the chain. A sale says **Paid (checked)** only
   when a reader has confirmed the receipt. Until then it says **Not confirmed yet**, and the reason
   is printed beside it. A sale that was refused says **Declined**.
6. **What was refused.** A stranger trying to pay someone else's sale. The lost tablet trying to
   raise a sale after being revoked. The register trying to raise a sale after being revoked. A
   look-alike copy trying to pass off a receipt. A sale too large for this installation to convert
   safely. All five are declined, and the run fails loudly if any of them stops being declined.
7. **The addresses to open** in a browser.

## The five commands

| Command | What it does |
|---|---|
| `make business-demo` | The whole story above, from an empty chain. Start here. |
| `make business-open` | Opens the business and customer screens in your browser and prints the addresses. |
| `make business-up` | Starts the practice chain and installs the product, without selling anything. |
| `make business-test` | Runs everything, including every refusal, and fails loudly on the first thing that misbehaves. This is the command that answers "does it actually work". |
| `make business-down` | Stops the screens and the practice chain. Safe to run twice. |

## The screens

After `make business-open`:

- **Your business** shows the sales and what each one is worth to you.
- **Take a payment** raises a new sale from a register.
- **Customer payment** is what the customer sees and pays from.
- **Add a business** is the door a new business joins through, from its own wallet.

## Three things worth knowing

**A register can be revoked, and revoking it does not undo a sale.** When the tablet goes missing you
revoke it and it can raise nothing more. The sales it already made stay exactly as they were, and
their receipts do not change. That is deliberate: a payment a customer already made is not yours to
withdraw afterwards.

**"Paid" is a claim about a receipt, not about a screen.** The business is told Paid only after a
reader has gone back to the chain and confirmed the receipt belongs to this installation. A payment
that went through but has not been confirmed says so, in those words.

**A sale is bound to one customer.** A sale raised for one person cannot be paid by another, cannot
be paid twice, and expires. There is a refusal above for each of those.

## If something goes wrong

Every command prints where its own detailed log is. `make business-down` then `make business-demo`
starts the whole thing again from an empty chain.
