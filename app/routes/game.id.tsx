import {
  Input,
  Button,
  Card,
  CardHeader,
  CardBody,
  Table,
  TableBody,
  TableRow,
  TableCell,
  TableColumn,
  TableHeader,
  Accordion,
  AccordionItem,
  Navbar,
  NavbarBrand,
  NavbarContent,
  NavbarItem,
  ScrollShadow,
} from "@nextui-org/react";
import { player, Round, round, score } from "@prisma/client";
import {
  Form,
  Link,
  useNavigation,
  useSearchParams,
  useSubmit,
} from "react-router";
import React, { useEffect, useMemo, useRef } from "react";
import { dataWithSuccess, redirectWithError } from "remix-toast";
import invariant from "tiny-invariant";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { getRoundScore, intToRound, roundToInt } from "../utils/appUtils";
import { Route } from "./+types/game.id";
import prisma from "../db.server";

export const meta: Route.MetaFunction = ({ params }) => {
  return [
    { title: `Game ${params.id}` },
    { name: "description", content: "Create of join Skull King game" },
  ];
};

export async function loader({ params }: Route.LoaderArgs) {
  let { id } = params;

  if (id === undefined) {
    throw await redirectWithError("/", `Game with id: ${id} doesn't exist`);
  }
  try {
    return await prisma.game.findUniqueOrThrow({
      where: { id: parseInt(id) },
      include: {
        players: true,
        rounds: {
          include: {
            scores: {
              orderBy: { player: { name: "asc" } },
              include: { player: true },
            },
          },
        },
      },
    });
  } catch (e) {
    throw await redirectWithError("/", `Game with id: ${id} doesn't exist`);
  }
}

let updateSchema = zfd.formData({
  scoreId: z.coerce.number(),
  roundNumber: z.coerce.number(),
  bid: z.coerce.number().optional(),
  won: z.coerce.number().optional(),
  loot: z.coerce.number().optional(),
  standardFourteen: z.coerce.number().optional(),
  blackFourteen: z.coerce.number().optional(),
  pirateMermaidCapture: z.coerce.number().optional(),
  skullKingPirateCapture: z.coerce.number().optional(),
  mermaidSkullKingCapture: z.coerce.number().optional(),
});

export async function action({ request, params }: Route.ActionArgs) {
  let { id } = params;
  invariant(id, "Must include id to create user");
  switch (request.method) {
    case "PUT": {
      let game = await prisma.game.findUniqueOrThrow({
        where: { id: parseInt(id) },
        include: { players: true, rounds: true },
      });
      let newRound = await prisma.round.create({
        data: {
          roundNumber: intToRound(game.rounds.length + 1),
          gameId: parseInt(id),
          started: new Date(),
        },
      });
      game.players.forEach(async (player: player) => {
        await prisma.score.create({
          data: {
            playerId: player.id,
            roundId: newRound.id,
            loot: 0,
            standardFourteen: 0,
            blackFourteen: 0,
            pirateMermaidCapture: 0,
            skullKingPirateCapture: 0,
            mermaidSkullKingCapture: 0,
          },
        });
      });
      return dataWithSuccess(
        "Started",
        `Started round ${game.rounds.length + 1}`
      );
    }
    case "PATCH": {
      let name = (await request.formData()).get("name")?.toString();
      invariant(name, "Must include name to create user");
      let player = await prisma.player.findFirst({ where: { name: name } });
      if (player === null) {
        player = await prisma.player.create({
          data: { name: name, game: { connect: { id: parseInt(id) } } },
        });
        return dataWithSuccess("created", `Created ${name} and added to game`);
      } else {
        invariant(player, "Player must exist");
        await prisma.player.update({
          where: { id: player.id },
          data: { game: { connect: { id: parseInt(id) } } },
        });
        return dataWithSuccess("used db", `Added ${name} to game`);
      }
    }
    case "POST":
      let { scoreId, roundNumber, ...rest } = updateSchema.parse(
        await request.formData()
      );
      let oldScore = await prisma.score.findUniqueOrThrow({
        where: { id: scoreId },
      });
      let newScore = { ...oldScore, ...rest };
      let updatedDelta = getRoundScore(newScore, roundNumber);
      newScore.scoreDelta = updatedDelta;

      return await prisma.score.update({
        where: {
          id: scoreId,
        },
        data: { ...newScore },
      });

    default:
      return null;
  }
}

export default function ({ loaderData }: Route.ComponentProps) {
  let data = loaderData;
  let [searchParams, setSearchParams] = useSearchParams();

  const setAccordionOpen = (keys: "all" | Set<React.Key>) => {
    if (keys instanceof Set) {
      if (keys.size === 0) {
        searchParams.delete("roundId");
      } else {
        searchParams.set("roundId", [...keys].join(","));
      }
      setSearchParams(searchParams);
    }
  };

  let formRef = useRef<HTMLFormElement>(null);
  let navigation = useNavigation();

  useEffect(() => {
    if (navigation.state === "idle") {
      formRef.current?.reset();
    }
  }, [navigation.state]);

  let lastRound = useMemo(
    () => data?.rounds[data.rounds.length - 1],
    [data?.rounds]
  );

  const submit = useSubmit();

  return (
    <div className="m-3">
      <Navbar maxWidth="full" isBordered className="p-0 m-0">
        <NavbarBrand>
          <Button as={Link} color="secondary" to={"/"}>
            Home
          </Button>
        </NavbarBrand>
        <NavbarContent data-justify="end">
          <NavbarItem>
            <Button
              color="warning"
              onPress={() =>
                submit(
                  {},
                  {
                    action: `/data/gameStatus/${data.id}`,
                    method: "PUT",
                    navigate: false,
                  }
                )
              }
            >
              Copy Game
            </Button>
          </NavbarItem>
          <NavbarItem>
            <Button
              color="danger"
              onPress={() =>
                submit(
                  {},
                  {
                    action: `/data/gameStatus/${data.id}`,
                    method: "DELETE",
                    navigate: false,
                  }
                )
              }
            >
              End Game
            </Button>
          </NavbarItem>
        </NavbarContent>
      </Navbar>
      <p className="text-2xl">Game in progress: {data.name}</p>
      <p>Started: {data.started.toLocaleString()}</p>
      <Accordion variant="bordered">
        <AccordionItem title={"Game Setup"}>
          <div className="flex flex-row gap-3">
            <Form
              ref={formRef}
              method="PATCH"
              className="w-[200px] flex flex-col gap-2"
            >
              <Input label="Name" name="name" className="text-black" />
              <Button
                color="success"
                type="submit"
                isDisabled={data.rounds.length > 0}
              >
                Add Player
              </Button>
              {data.rounds.length > 0 &&
                "Game has already started cannot add new players"}
            </Form>
            <div>
              {data?.players ? (
                <>
                  <p>Players:</p>
                  <ul className="indent-3">
                    {data?.players?.map((player: player) => (
                      <p key={player.name}>{player.name}</p>
                    ))}
                  </ul>
                </>
              ) : (
                <p>No Players</p>
              )}
            </div>
          </div>
        </AccordionItem>
      </Accordion>

      <Accordion
        selectionMode="multiple"
        key={data.rounds.length}
        onSelectionChange={setAccordionOpen}
        defaultExpandedKeys={searchParams.get("roundId")?.split(",")}
      >
        {data?.rounds?.map((round) => {
          return (
            <AccordionItem
              key={round.id}
              title={`Round: ${roundToInt(round.roundNumber)}`}
            >
              <div className="flex flex-row gap-3">
                <ScrollShadow className="" orientation="horizontal">
                  {round.scores.map((score) => {
                    return (
                      <Card key={score.id} className="min-w-[325px]">
                        <CardHeader>
                          <p>
                            {score.player.name}
                            <br />
                            {"Round score: "}
                            {score.scoreDelta}
                          </p>
                        </CardHeader>
                        <CardBody>
                          <ClickableBoard
                            name="bid"
                            currentRound={roundToInt(round.roundNumber)}
                            value={score?.bid ?? undefined}
                            scoreId={score.id}
                          />
                          <ClickableBoard
                            name="won"
                            currentRound={roundToInt(round.roundNumber)}
                            value={score?.won ?? undefined}
                            scoreId={score.id}
                          />
                          <BonusPointsScoring
                            score={score}
                            roundNumber={roundToInt(round.roundNumber)}
                          />
                        </CardBody>
                      </Card>
                    );
                  })}
                </ScrollShadow>
              </div>
            </AccordionItem>
          );
        })}
      </Accordion>
      <Form method="PUT" className="mb-2">
        <Button
          color="primary"
          type="submit"
          isDisabled={data.players.length === 0}
        >
          {lastRound
            ? lastRound.roundNumber === Round.TEN
              ? "End Game"
              : "Start Next Round"
            : "Start First Round"}
        </Button>
        {data.players.length === 0 && <p>Please add players to game</p>}
      </Form>
      <ScoreBoard rounds={data.rounds} />
    </div>
  );
}

function BonusPointsScoring({
  score,
  roundNumber,
}: {
  score: score;
  roundNumber: number;
}) {
  return (
    <Accordion variant="bordered">
      <AccordionItem title="Bonus Points" className="overflow-hidden">
        <Form method="POST" className="flex flex-col gap-2">
          <input hidden readOnly name="scoreId" value={score.id} />
          <input hidden readOnly name="roundNumber" value={roundNumber} />
          <ButtonAction
            name="loot"
            displayName="Loot"
            value={score.loot ?? 0}
          />
          <ButtonAction
            name="standardFourteen"
            displayName="Standard 14"
            value={score.standardFourteen ?? 0}
          />
          <ButtonAction
            name="blackFourteen"
            displayName="Black 14"
            value={score.blackFourteen ?? 0}
          />
          <ButtonAction
            name="pirateMermaidCapture"
            displayName="Pirate < Mermaid"
            value={score.pirateMermaidCapture ?? 0}
          />
          <ButtonAction
            name="skullKingPirateCapture"
            displayName="Skull King < Pirate"
            value={score.skullKingPirateCapture ?? 0}
          />
          <ButtonAction
            name="mermaidSkullKingCapture"
            displayName="Mermaid < Skull King"
            value={score.mermaidSkullKingCapture ?? 0}
          />
        </Form>
      </AccordionItem>
    </Accordion>
  );
}

function ButtonAction({
  value,
  name,
  displayName,
}: {
  value: number;
  name: string;
  displayName: string;
}) {
  return (
    <div className="flex flex-row gap-1 justify-between align-middle items-center text-center">
      <p>{displayName}</p>
      <div className="flex flex-row min-w-fit items-center gap-1">
        <p className="mr-2">{value}</p>
        <Button
          isIconOnly
          variant="faded"
          size="sm"
          type="submit"
          name={name}
          value={value + 1}
        >
          +
        </Button>
        <Button
          isIconOnly
          variant="faded"
          size="sm"
          type="submit"
          name={name}
          value={value - 1}
          isDisabled={value === 0}
        >
          -
        </Button>
      </div>
    </div>
  );
}

function ScoreBoard({
  rounds,
}: {
  rounds: (round & { scores: (score & { player: player })[] })[];
}) {
  let scoreMap = new Map();
  let scoresPerRound = rounds.flatMap((round) => round.scores);
  let players = [...new Set(scoresPerRound.map((score) => score.player.name))];

  players.forEach((name) => {
    let score = scoresPerRound
      .filter((score) => score.player.name === name)
      .reduce((sum, items) => sum + (items?.scoreDelta ?? 0), 0);
    scoreMap.set(name, score);
  });

  let currentRound = findMaxValue(rounds, "roundNumber");
  const scores = Array.from(scoreMap.values()).sort((a, b) => b - a);

  function findMaxValue(arr: round[], key: keyof round): number | undefined {
    return arr.reduce(
      (max, item) => Math.max(max, item[key] as number),
      -Infinity
    );
  }

  function findRank(rank: number) {
    const ranking = scores.indexOf(rank) + 1;
    return ranking > 0 ? ranking : -1;
  }

  return (
    <Table
      aria-label="Example static collection table"
      className="w-[95vw] lg:w-[500px] my-5"
      isStriped
    >
      <TableHeader>
        <TableColumn>NAME</TableColumn>
        <TableColumn>SCORE</TableColumn>
        <TableColumn>PLACEMENT</TableColumn>
        {/* <TableColumn>PRIOR ROUND SCORE</TableColumn> */}
      </TableHeader>
      <TableBody>
        {players.map((name) => (
          <TableRow key={name}>
            <TableCell>{name}</TableCell>
            <TableCell>{scoreMap.get(name)}</TableCell>
            <TableCell>{findRank(scoreMap.get(name))}</TableCell>
            {/* <TableCell>{}</TableCell> */}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

type BoardProps = {
  currentRound: number;
  value?: number;
  name: string;
  scoreId: number;
};

const ClickableBoard: React.FC<BoardProps> = ({
  currentRound,
  value,
  name,
  scoreId,
}) => {
  const chunks = chunkArray(currentRound, 3);
  return (
    <Form method="POST" className="flex flex-col gap-2 mb-2">
      <input hidden readOnly name="scoreId" value={scoreId} />
      <input hidden readOnly name="roundNumber" value={currentRound} />
      <p className="text-lg">{name}</p>
      {chunks.map((chunk, index) => (
        <div className="flex flex-row gap-1" key={index}>
          {chunk.map((numberCard) => (
            <Button
              key={numberCard}
              type="submit"
              name={name}
              value={numberCard}
              color={value === numberCard ? "primary" : "default"}
            >
              {numberCard}
            </Button>
          ))}
        </div>
      ))}
    </Form>
  );
};

function createArray(n: number): number[] {
  return Array.from({ length: n + 1 }, (_, i) => i);
}

function chunkArray(n: number, chunkSize: number): number[][] {
  let holderArray = createArray(n);
  const result: number[][] = [];
  for (let i = 0; i < holderArray.length; i += chunkSize) {
    result.push(holderArray.slice(i, i + chunkSize));
  }
  return result;
}
