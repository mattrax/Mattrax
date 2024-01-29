const { faker } = require("@faker-js/faker");
const fs = require("node:fs");

const users = [];

for (let i = 0; i < 1000; i++) {
  users.push({
    id: i,
    name: faker.person.fullName(),
    email: faker.internet.email(),
  });
}

fs.writeFileSync("../api/src/routes/users.json", JSON.stringify(users));
