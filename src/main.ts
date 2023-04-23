import * as SES from "@aws-sdk/client-ses";
import * as cron from "cron";
import * as dotenv from "dotenv";
import * as kijiji from "kijiji-scraper";
import * as mongodb from "mongodb";

interface User {
  email: string;
}

interface Ad {
  kijijiId: string;
  lastSeen: Date;
}

function getAds(): Promise<kijiji.Ad[]> {
  const params: kijiji.SearchParameters = {
    q: "pinball",
    locationId: kijiji.locations.ONTARIO,
    adType: "OFFERED",
    sortType: "DATE_DESCENDING",
  };

  return kijiji.search(params);
}

async function getNewAds(ads: kijiji.Ad[]): Promise<kijiji.Ad[]> {
  const adCollection = db.collection<Ad>("ads");
  const adIds = ads.map((ad) => ad.id);
  const seenAds = adCollection.find({ kijijiId: { $in: adIds } });
  const seenAdIds = await seenAds.map((ad) => ad.kijijiId).toArray();
  const newAds = ads.filter((ad) => !seenAdIds.includes(ad.id));
  const now = new Date();
  await adCollection.bulkWrite(
    adIds.map((id) => {
      return {
        updateOne: {
          filter: { kijijiId: id },
          update: { $set: { kijijiId: id, lastSeen: now } },
          upsert: true,
        },
      };
    })
  );
  const monthAgo = new Date(now);
  monthAgo.setDate(monthAgo.getDate() - 30);
  await adCollection.deleteMany({ lastSeen: { $lt: monthAgo } });

  return newAds;
}

function getEmails(): Promise<string[]> {
  const userCollection = db.collection<User>("users");
  const users = userCollection.find({ email: { $type: "string" } });
  const emails = users.map((user) => user.email);

  return emails.toArray();
}

async function sendAlerts(ads: kijiji.Ad[]) {
  let msgBody = "";

  for (let i = 0; i < ads.length; i++) {
    msgBody += `${ads[i].title}:\n${ads[i].url}\n`;
  }

  const params = new SES.SendEmailCommand({
    Source: FROM_EMAIL,
    Destination: {
      BccAddresses: await getEmails(),
    },
    Message: {
      Subject: {
        Data: "Pinball Kijiji Alert",
      },
      Body: {
        Text: {
          Data: msgBody,
        },
      },
    },
  });

  sesClient
    .send(params)
    .then((data) => console.log(data.MessageId))
    .catch(console.error);
}

dotenv.config();
const DB_URI = process.env.DB_URI ?? "";
const FROM_EMAIL = process.env.FROM_EMAIL ?? "";
const sesClient = new SES.SESClient({ region: "us-east-2" });
const dbClient = new mongodb.MongoClient(DB_URI);
const db = dbClient.db("pinball-scraper");

const job = cron.job("0 * * * * *", () => {
  void (async () => {
    const ads = await getAds();
    const newAds = await getNewAds(ads);

    if (newAds.length > 0) {
      await sendAlerts(newAds);
    }
  })();
});

job.start();
