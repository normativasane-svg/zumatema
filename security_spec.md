# Security Specification - Math Zuma Leaderboard

## 1. Data Invariants
- A score record must have a valid `name` (string, max 20 chars).
- A score record must have a positive `score` (number).
- A score record must have a valid `mode` ('multiples' or 'divisors').
- `createdAt` must be set to the server timestamp.
- Users can ONLY create documents. They cannot update or delete any document in the leaderboard once submitted. This prevents leaderboard tampering.
- Read access is public for the leaderboard.

## 2. The "Dirty Dozen" Payloads
1. **Name Spoofing**: Attempt to save a score with a name that is an object or array.
2. **Score Inflation**: Attempt to save a score value that is a string instead of a number.
3. **Negative Score**: Attempt to save a negative score.
4. **Massive Payload**: Attempt to save a score with a 1MB string in one of the fields.
5. **Update Attack**: Attempt to update someone else's score (or even your own) to a higher value.
6. **Deletion Attack**: Attempt to delete the top scores.
7. **Timestamp Spoofing**: Attempt to set `createdAt` to a date in the past or future manually.
8. **Field Injection**: Attempt to add a field `isAdmin: true` to a record.
9. **Zero-Byte Name**: Attempt to save a record with an empty string as a name.
10. **ID Poisoning**: Attempt to use `../` or long strings as document IDs.
11. **Type Mismatch**: Attempt to save `target` as a boolean.
12. **Anonymous Spam**: (If auth was enforced, but here it's public write but we will restrict it to authenticated if possible). *Wait, the app doesn't have login yet. I should probably add simple anonymous auth or just allow public writes with strict schema.*

## 3. Test Runner (Conceptual)
All "Dirty Dozen" payloads should result in `PERMISSION_DENIED` except for public reads.
Specifically, `allow update, delete: if false;` will block most attacks.
`allow create` will have `isValidScore()` check.
