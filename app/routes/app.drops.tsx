import { useState, useCallback } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useSubmit, useNavigation } from "react-router";
import {
  Page,
  Layout,
  Card,
  Text,
  IndexTable,
  Button,
  Modal,
  FormLayout,
  TextField,
  Select,
  Badge,
  useIndexResourceState,
  BlockStack
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);

  const drops = await prisma.drop.findMany({
    where: { isActive: true },
    include: { _count: { select: { dropAssets: true } } },
    orderBy: { releaseDate: "desc" },
  });

  return { drops };
}

export async function action({ request }: ActionFunctionArgs) {
  await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "create") {
    const title = formData.get("title") as string;
    const requiredTierLevel = parseInt(formData.get("requiredTierLevel") as string);
    const releaseDateStr = formData.get("releaseDate") as string;

    await prisma.drop.create({
      data: {
        title,
        requiredTierLevel,
        releaseDate: new Date(releaseDateStr),
      },
    });

    return { success: true };
  }

  if (intent === "delete") {
    const dropId = formData.get("dropId") as string;
    await prisma.drop.update({
      where: { id: dropId },
      data: { isActive: false },
    });
    return { success: true };
  }

  return { error: "Unknown intent" };
}

export default function DropsPage() {
  const { drops } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const nav = useNavigation();
  const isSaving = nav.state === "submitting" && nav.formData?.get("intent") === "create";

  const [modalOpen, setModalOpen] = useState(false);
  const toggleModal = useCallback(() => setModalOpen((active) => !active), []);

  const [title, setTitle] = useState("");
  const [requiredTier, setRequiredTier] = useState("1");
  const [releaseDate, setReleaseDate] = useState("");

  const handleCreate = useCallback(() => {
    submit(
      { intent: "create", title, requiredTierLevel: requiredTier, releaseDate },
      { method: "post" }
    );
    setModalOpen(false);
    setTitle("");
  }, [title, requiredTier, releaseDate, submit]);

  const handleDelete = useCallback(
    (id: string) => submit({ intent: "delete", dropId: id }, { method: "post" }),
    [submit]
  );

  const resourceName = { singular: "drop", plural: "drops" };
  const { selectedResources, allResourcesSelected, handleSelectionChange } =
    useIndexResourceState(drops);

  const rowMarkup = drops.map((drop, index) => {
    const isReleased = new Date(drop.releaseDate) <= new Date();

    return (
      <IndexTable.Row
        id={drop.id}
        key={drop.id}
        selected={selectedResources.includes(drop.id)}
        position={index}
      >
        <IndexTable.Cell>
          <Text fontWeight="bold" as="span">{drop.title}</Text>
        </IndexTable.Cell>
        <IndexTable.Cell>Level {drop.requiredTierLevel}+</IndexTable.Cell>
        <IndexTable.Cell>{drop._count.dropAssets} Assets</IndexTable.Cell>
        <IndexTable.Cell>
          {new Date(drop.releaseDate).toLocaleDateString()}
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Badge tone={isReleased ? "success" : "info"}>
            {isReleased ? "Released" : "Upcoming"}
          </Badge>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Button size="micro" tone="critical" onClick={() => handleDelete(drop.id)}>
            Remove
          </Button>
        </IndexTable.Cell>
      </IndexTable.Row>
    );
  });

  return (
    <Page
      title="Temporal Drops Manager"
      backAction={{ content: "Home", url: "/app" }}
      primaryAction={{ content: "Schedule Drop", onAction: toggleModal }}
    >
      <Layout>
        <Layout.Section>
          <Card padding="500">
            <BlockStack gap="300">
              <Text variant="headingLg" as="h2">What are Content Drops?</Text>
              <Text as="p">
                Drops are time-released marketing events. A Drop keeps a Digital Pack completely hidden from your customers' vault until a specific date and time.
              </Text>
              <Text as="p" fontWeight="bold">How to use it:</Text>
              <Text as="p" tone="subdued">
                Give the drop a title, specify the minimum Tier Level required, and set the unlock date. Your eligible customers will see a countdown to the drop in their portal, building hype!
              </Text>
              <Text as="p" fontWeight="bold">Example:</Text>
              <Text as="p" tone="subdued">
                You schedule the "Holiday Exclusives" drop to automatically go live and unlock its contents on December 25th for everyone who owns Level 2 (Standard) or above.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
        <Layout.Section>
          <Card padding="0">
            <IndexTable
              resourceName={resourceName}
              itemCount={drops.length}
              selectedItemsCount={
                allResourcesSelected ? "All" : selectedResources.length
              }
              onSelectionChange={handleSelectionChange}
              headings={[
                { title: "Title" },
                { title: "Required Tier" },
                { title: "Assets" },
                { title: "Release Date" },
                { title: "Status" },
                { title: "Actions" },
              ]}
            >
              {rowMarkup}
            </IndexTable>
          </Card>
        </Layout.Section>
      </Layout>

      <Modal
        open={modalOpen}
        onClose={toggleModal}
        title="Schedule Content Drop"
        primaryAction={{
          content: "Save Drop",
          onAction: handleCreate,
          loading: isSaving,
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: toggleModal,
          },
        ]}
      >
        <Modal.Section>
          <FormLayout>
            <TextField
              label="Drop Title"
              value={title}
              onChange={setTitle}
              autoComplete="off"
              helpText="e.g. 'Bonus Halloween Art Kit'"
            />
            <Select
              label="Required Tier Level"
              options={[
                { label: "Level 1 (Lite) and up", value: "1" },
                { label: "Level 2 (Standard) and up", value: "2" },
                { label: "Level 3 (Deluxe) and up", value: "3" },
                { label: "Level 4 (Ultimate) Only", value: "4" },
              ]}
              value={requiredTier}
              onChange={setRequiredTier}
              helpText="Customers must have bought a product activating this tier or higher to access this drop."
            />
            <TextField
              type="date"
              label="Release Date"
              value={releaseDate}
              onChange={setReleaseDate}
              autoComplete="off"
              helpText="The drop will automatically become visible for eligible customers on this date."
            />
          </FormLayout>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
