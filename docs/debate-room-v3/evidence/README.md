# Local evidence and synthetic exports

These files support local implementation review. They do not establish a hosted deployment, physical media, a continuous 90-minute rehearsal, provider capacity, actual email delivery, or public-launch approval.

`local-verification-20260909.json` records the exact local test report, source hashes, historical failures and their retests, artifact checks, export hashes, and remaining gates. The source checkpoint in that report is not a claim that the then-uncommitted implementation was already deployed.

[Candidate cb45d509 CI evidence](ci-validation-cb45d509.json) records the identical tested Git tree, all thirteen passing Debate groups, all 1,703 passing Worker tests, and the separate unchanged media-download failure. These runs do not include the new dedicated Debate or Study browser journeys and do not establish a deployment.

The `samples` folder contains actual authorized export-job output from disposable local databases using synthetic identities. No real participant data or provider connection was used. The original case runs the rehearsal flow; the positive case runs two completed matches to verify eligible tournament awards and a disclosed sanction-adjusted decision. Its synthetic competition flag permits award logic only inside that disposable test service and is never a public configuration.

- [Rules](samples/original-rules.pdf)
- [Judge scorecard](samples/original-scorecard.pdf)
- [Result and separate Audience Choice](samples/original-result.pdf)
- [Event report](samples/original-event_report.pdf)
- [CSV](samples/original-csv.csv)
- [Synthetic organizer certificate](samples/original-certificate.pdf)
- [Declared sanction rules](samples/positive-rules.pdf)
- [Raw and adjusted result](samples/positive-result.pdf)
- [Eligible tournament awards](samples/positive-event_report.pdf)

All 17 pages across the eight PDFs were visually inspected after the final renderer change. Text, pagination and hashes passed; the CSV passed content and hash checks. Earlier failed pagination and attendance fixtures remain in ignored local execution artifacts and are not substituted for the final outputs.

The current browser-control tool repeatedly failed on both Chrome and the task-owned in-app tab with CDP focus/navigation timeouts. Earlier real-browser evidence covers only the listed partial actions; the entire latest browser organizer flow remains unverified. The saved loopback rehearsal can be resumed at `http://127.0.0.1:4178/debate-room/`, with provider media and real mail disabled.
