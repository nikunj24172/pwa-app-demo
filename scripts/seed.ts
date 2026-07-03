/**
 * Seed script — creates demo users and Vehicle/Property/Company records.
 * Run: npm run seed
 */
import { existsSync } from "node:fs";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { User } from "../src/lib/models/User";
import { Vehicle, Property, Company } from "../src/lib/models/SearchRecords";
import { WebAuthnCredential } from "../src/lib/models/WebAuthnCredential";
import { FileSession } from "../src/lib/models/FileSession";
import { AuditLog } from "../src/lib/models/AuditLog";
import { SessionPhoto } from "../src/lib/models/SessionPhoto";
import { SessionRecord } from "../src/lib/models/SessionRecord";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const URI = process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27017/infolog_pwa";

const ALL_PERMS = [
  "search:vehicle",
  "search:property",
  "search:company",
  "session:create",
  "audit:view",
] as const;

async function main() {
  await mongoose.connect(URI);
  console.log("Connected:", URI);

  await Promise.all([
    User.deleteMany({}),
    Vehicle.deleteMany({}),
    Property.deleteMany({}),
    Company.deleteMany({}),
    WebAuthnCredential.deleteMany({}),
    FileSession.deleteMany({}),
    AuditLog.deleteMany({}),
    SessionPhoto.deleteMany({}),
    SessionRecord.deleteMany({}),
  ]);

  // Accounts. Password scheme is <FirstName>@123 for everyone.
  const accounts = [
    {
      email: "nikunj.chudasama@savannah-labs.com",
      name: "Nikunj Chudasama",
      role: "admin",
      password: "Nikunj@123",
    },
    {
      email: "vatsal.parmar@savannah-labs.com",
      name: "Vatsal Parmar",
      role: "officer",
      password: "Vatsal@123",
    },
    {
      email: "shruti.jain@savannah-labs.com",
      name: "Shruti Jain",
      role: "officer",
      password: "Shruti@123",
    },
  ] as const;

  for (const a of accounts) {
    await User.create({
      username: a.email,
      email: a.email,
      name: a.name,
      passwordHash: await bcrypt.hash(a.password, 10),
      role: a.role,
      permissions: [...ALL_PERMS],
    });
    console.log(`User: ${a.email}  (password = ${a.password})`);
  }

  await Vehicle.create([
    {
      registration: "RCF722",
      make: "Ford",
      model: "Ranger Wildtrak 2.0D / 4WD Utility",
      year: 2025,
      vin: "MPBCMFF60RX653797",
      color: "Meteor Grey",
      usage: "Private Passenger",
      vehicleType: "Goods Van/Truck/Utility",
      bodyStyle: "Utility",
      fuelType: "Diesel",
      reportedStolen: false,
      registrationDate: "2025-02-27",
      registrationStatus: "Complete",
      latestOdometer: 15,
      registeredOwners: 1,
      dateOfReport: "2026-06-29",
      owner: {
        name: "Fuel Media Limited",
        type: "Company",
        address: "11B Kennedy Avenue, Forrest Hill, Auckland 0620",
        mailingAddress: "PO Box 33-1234, Takapuna, Auckland 0740",
        acquisitionDate: "2025-02-27",
      },
      status: "clean",
    },
    {
      registration: "KJT918",
      make: "Toyota",
      model: "Hilux SR5 2.8D / 4WD Double Cab",
      year: 2021,
      vin: "AHTFR22G0M4001234",
      color: "White",
      usage: "Private Passenger",
      vehicleType: "Goods Van/Truck/Utility",
      bodyStyle: "Double Cab Utility",
      fuelType: "Diesel",
      reportedStolen: false,
      registrationDate: "2021-08-14",
      registrationStatus: "Complete",
      latestOdometer: 68450,
      registeredOwners: 2,
      dateOfReport: "2026-06-29",
      owner: {
        name: "Sarah Thompson",
        type: "Individual",
        address: "42 Adelaide Road, Newtown, Wellington 6021",
        mailingAddress: "42 Adelaide Road, Newtown, Wellington 6021",
        acquisitionDate: "2023-05-02",
      },
      checks: { advertising: "1 result found (2023)", policeStolen: "No results found", writtenOff: "No results found" },
      status: "flagged",
    },
    {
      registration: "BUZ204",
      make: "Holden",
      model: "Commodore SV6 3.6 / Sedan",
      year: 2018,
      vin: "6G1EK5E39JL123987",
      color: "Red",
      usage: "Private Passenger",
      vehicleType: "Passenger Car/Van",
      bodyStyle: "Sedan",
      fuelType: "Petrol",
      reportedStolen: true,
      registrationDate: "2018-03-11",
      registrationStatus: "Complete",
      latestOdometer: 132900,
      registeredOwners: 3,
      dateOfReport: "2026-06-29",
      owner: {
        name: "Peter Nguyen",
        type: "Individual",
        address: "9 Riccarton Road, Riccarton, Christchurch 8011",
        mailingAddress: "9 Riccarton Road, Riccarton, Christchurch 8011",
        acquisitionDate: "2020-11-19",
      },
      checks: { advertising: "No results found", policeStolen: "Reported stolen 12/03/2026", writtenOff: "No results found" },
      status: "stolen",
    },
    {
      registration: "MNP557",
      make: "Mazda",
      model: "CX-5 GSX 2.5 / SUV",
      year: 2022,
      vin: "JM0KFXXW600123654",
      color: "Soul Red",
      usage: "Business",
      vehicleType: "Passenger Car/Van",
      bodyStyle: "Station Wagon",
      fuelType: "Petrol",
      reportedStolen: false,
      registrationDate: "2022-06-30",
      registrationStatus: "Complete",
      latestOdometer: 41200,
      registeredOwners: 1,
      dateOfReport: "2026-06-29",
      owner: {
        name: "Southern Logistics Limited",
        type: "Company",
        address: "120 Halsey Street, Wynyard Quarter, Auckland 1010",
        mailingAddress: "PO Box 90-887, Auckland 1142",
        acquisitionDate: "2022-06-30",
      },
      status: "clean",
    },
  ]);

  await Property.create([
    { erfNumber: "NA123A/456", address: "11B Kennedy Avenue", suburb: "Forrest Hill", city: "Auckland", ownerName: "Fuel Media Limited", ownerType: "Company", valuation: 1985000, landArea: "612 m²", registrationStatus: "Complete", lastTransferDate: "2025-02-27", status: "clean" },
    { erfNumber: "WN45C/210", address: "42 Adelaide Road", suburb: "Newtown", city: "Wellington", ownerName: "Sarah Thompson", ownerType: "Individual", valuation: 875000, landArea: "320 m²", registrationStatus: "Complete", lastTransferDate: "2023-05-02", status: "flagged" },
    { erfNumber: "CB98D/775", address: "9 Riccarton Road", suburb: "Riccarton", city: "Christchurch", ownerName: "Peter Nguyen", ownerType: "Individual", valuation: 640000, landArea: "455 m²", registrationStatus: "Complete", lastTransferDate: "2020-11-19", status: "clean" },
    { erfNumber: "NA771B/903", address: "120 Halsey Street", suburb: "Wynyard Quarter", city: "Auckland", ownerName: "Southern Logistics Limited", ownerType: "Company", valuation: 12400000, landArea: "2,140 m²", registrationStatus: "Complete", lastTransferDate: "2022-06-30", status: "clean" },
  ]);

  await Company.create([
    { registrationNumber: "NZBN 9429041234567", name: "Fuel Media Limited", status: "active", incorporationDate: "2016-04-12", directors: ["Timothy Clarke", "Rebecca Hall"], registeredAddress: "11B Kennedy Avenue, Forrest Hill, Auckland 0620", vatNumber: "123-456-789", industry: "Advertising & Media" },
    { registrationNumber: "NZBN 9429037654321", name: "Southern Logistics Limited", status: "active", incorporationDate: "2011-09-30", directors: ["David Reid", "Aroha Williams"], registeredAddress: "120 Halsey Street, Wynyard Quarter, Auckland 1010", vatNumber: "987-654-321", industry: "Transport & Warehousing" },
    { registrationNumber: "NZBN 9429029988776", name: "Kauri Coastal Trading Limited", status: "deregistered", incorporationDate: "2009-01-15", directors: ["Sarah Thompson"], registeredAddress: "42 Adelaide Road, Newtown, Wellington 6021", vatNumber: "456-778-990", industry: "Wholesale Trade" },
  ]);

  console.log("Seeded vehicles, properties, companies.");
  await mongoose.disconnect();
  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
