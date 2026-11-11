# Switching on the shared version

Written 2026-11-11. Nothing in this file is built yet except the plug-in point. It records what was decided so that turning the shared version on is a short job.

## Where things stand

The app runs in one browser. A board post, a voice message and an uploaded file are kept there and reach nobody else. The Share button is the only way a post leaves the device today.

The board talks to one small module, `src/backend.js`. It has six functions: `list`, `publish`, `remove`, `file`, `clear`, and two facts about itself, `shared` and `where`. The version in use, `localBoard`, keeps posts in the saved workspace and files in the browser's IndexedDB. A hosted version provides the same six over HTTP and replaces one line in `src/main.js`. The schedule, requests and directory are not behind this module yet. They need the same treatment before they can be shared.

## What the owner will have to do

1. Create one free account with the hosting service.
2. Approve the connection so the app can be deployed to it.
3. Send each coworker their personal link.

There is no machine to run or look after.

## What has to be built first

- **Accounts by personal invite link.** Decided by the owner. One link per person, sent from the Directory's Text button. The link is the login. A shared link could be forwarded, and whoever opened it could claim any name.
- **Each person adds their own phone number** when they join. The whole telephone list is not uploaded on anyone's behalf.
- **The hosted board:** the six functions above as HTTP calls, a database table for posts, and a file store for attachments. Large videos go straight from the phone to the file store, because the request size through the service itself is capped.
- **Roles.** At least two admins, so the department does not depend on one person's account. Admins can remove any post.
- **A report button** on every post.
- **The schedule, requests and directory** moved behind the same kind of module.
- **Direct messages**, then trades that both people confirm from their own phones.

## A language model for Ask

Ask works today by looking things up, with no model. A model could broaden supported wording and provide summaries. For a hosted API, keep the provider key on the server rather than in the app. That route would incur the provider's usage charges and send selected records to that provider. A local model is also possible but is not implemented. Hand a model only records the person asking is allowed to see, keep the source and date on every answer, and establish an approved processing route before sending department documents to an outside service.

## Hosting

The pick is Cloudflare: Workers for the service, D1 for the database, R2 for files. Figures read from their pricing pages on 2026-11-11:

- Workers free plan: 100,000 requests a day.
- D1 free plan: 5 GB.
- R2: the first 10 GB of files each month are free, and there is no charge for downloading or streaming them. Past 10 GB, storage is $0.015 per GB a month. A hundred GB of video would be about $1.35 a month.
- Requests through a Worker are capped at 100 MB on the free plan, which is why large videos must upload directly to R2.

Compared on the same day: Supabase's free plan allows 1 GB of files and 50 MB per file and pauses a project after a week without use. Netlify's free plan gives 300 credits a month, with bandwidth at 20 credits per GB and each production deploy at 15.

Not confirmed: whether Cloudflare asks for a payment card before R2 can be switched on.

## Risks to settle before rollout

- **Patient information.** Pictures, video and recordings made on a hospital unit are where it leaks, and no free hosting plan is set up to hold it. The rule is shown at every upload. Removal by the poster exists. Removal by an admin and the report button are still to build.
- **Other people's courses.** A third-party CEU course should be posted as a link, not uploaded. Watching in the app does not award credit.
- **No alerts.** A web app can only alert an iPhone after it has been added to the home screen. Until that is built, people have to open the app to see anything new.
- **Recordings across devices.** A voice message is recorded as AAC in an .m4a where the browser can, and as Opus in a .webm otherwise. Whether every phone in the department plays both has not been tested on real devices.
- **YouTube and Vimeo players** load only when tapped. They have not been tested against the live sites from this build.
