import {
  Autocomplete,
  AutocompleteItem,
  Button,
  Input,
} from "@nextui-org/react";
import { game } from "@prisma/client";
import { data, Form, useNavigate } from "react-router";
import { Key } from "react";
import { dataWithWarning, redirectWithSuccess } from "remix-toast";
import invariant from "tiny-invariant";
import prisma from "../db.server";
import { Route } from "./+types/_index";

export const meta: Route.MetaFunction = () => {
  return [
    { title: "Skull King" },
    { name: "description", content: "Create of join Skull King game" },
  ];
};

export async function loader({}: Route.LoaderArgs) {
  return data({
    users: await prisma.player.findMany(),
    nonCompleteGames: await prisma.game.findMany({
      where: { inProgress: true },
    }),
  });
}

export async function action({ request }: Route.ActionArgs) {
  let formData = await request.formData();
  let action = formData.get("action")?.toString();

  if (action === "create") {
    let gameName = formData.get("name")?.toString();
    console.log(gameName);
    try {
      invariant(gameName, "Must include game name");
      let game = await prisma.game.create({
        data: {
          name: gameName,
          started: new Date(),
          inProgress: true,
        },
      });
      return redirectWithSuccess(`/game/${game.id}`, "Created game");
    } catch (e) {
      console.error(e);
      return dataWithWarning(
        "caught",
        `Could not create game with error: ${e}`
      );
    }
  }
  return null;
}

export default function Index({ loaderData }: Route.ComponentProps) {
  let { users, nonCompleteGames } = loaderData;

  let navigate = useNavigate();

  const navigateToInProgressGame = (e: Key | null) => {
    if (e) {
      return navigate(`/game/${e}`);
    }
  };

  return (
    <div className="p-6 flex h-screen items-center justify-center">
      <div className="flex flex-col items-center gap-16">
        <header className="flex flex-col items-center gap-9">
          <h1 className="leading text-2xl font-bold text-gray-800 dark:text-gray-100">
            Welcome to Skull King tracker
          </h1>
        </header>
        <div className="flex items-center justify-center gap-4">
          <Form
            method="POST"
            encType="multipart/form-data"
            className="grid grid-cols-2 gap-2"
          >
            <div className="flex flex-col gap-3">
              <Input
                name="name"
                label="Game Name"
                placeholder="Please enter a name"
              />
              <Button
                color="primary"
                name="action"
                type="submit"
                value={"create"}
              >
                Create Game
              </Button>
            </div>
            <Autocomplete
              key={"GameAutocomplete"}
              label="Join game selector"
              onSelectionChange={(e) => navigateToInProgressGame(e)}
            >
              {nonCompleteGames.map((game: game) => (
                <AutocompleteItem key={game.id} textValue={game.name}>
                  {game.name}, started: {game.started.toLocaleString()}
                </AutocompleteItem>
              ))}
            </Autocomplete>
          </Form>
        </div>
      </div>
    </div>
  );
}
