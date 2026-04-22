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
  BlockStack,
  Banner,
  useIndexResourceState,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);

  const mappings = await prisma.productVariantPackMap.findMany({
    include: { pack: { include: { tier: true } } },
    orderBy: { createdAt: "desc" },
  });

  const packs = await prisma.pack.findMany({
    where: { isActive: true },
    include: { tier: true },
    orderBy: { name: "asc" },
  });

  return { mappings, packs };
}

export async function action({ request }: ActionFunctionArgs) {
  await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "create") {
    const variantId = formData.get("variantId") as string;
    const productId = formData.get("productId") as string;
    const packId = formData.get("packId") as string;

    if (!variantId || !packId) {
      return { success: false, error: "Variant ID and Pack are required." };
    }

    // Check for duplicate
    const existing = await prisma.productVariantPackMap.findUnique({
      where: { variantId },
    });
    if (existing) {
      return {
        success: false,
        error: `Variant ${variantId} is already mapped to a pack.`,
      };
    }

    await prisma.productVariantPackMap.create({
      data: { variantId, productId: productId || "manual", packId },
    });
    return { success: true };
  }

  if (intent === "delete") {
    const mappingId = formData.get("mappingId") as string;
    await prisma.productVariantPackMap.delete({ where: { id: mappingId } });
    return { success: true };
  }

  return { success: false };
}

export default function VariantMappingPage() {
  const { mappings, packs } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const nav = useNavigation();
  const isSaving =
    nav.state === "submitting" && nav.formData?.get("intent") === "create";

  const [modalOpen, setModalOpen] = useState(false);
  const toggleModal = useCallback(
    () => setModalOpen((prev) => !prev),
    [],
  );

  const [variantId, setVariantId] = useState("");
  const [productId, setProductId] = useState("");
  const [selectedPack, setSelectedPack] = useState(packs[0]?.id || "");

  const handleCreate = useCallback(() => {
    submit(
      { intent: "create", variantId, productId, packId: selectedPack },
      { method: "post" },
    );
    setModalOpen(false);
    setVariantId("");
    setProductId("");
  }, [variantId, productId, selectedPack, submit]);

  const handleDelete = useCallback(
    (id: string) => {
      submit({ intent: "delete", mappingId: id }, { method: "post" });
    },
    [submit],
  );

  const resourceName = { singular: "mapping", plural: "mappings" };
  const { selectedResources, allResourcesSelected, handleSelectionChange } =
    useIndexResourceState(mappings);

  const rowMarkup = mappings.map((mapping, index) => (
    <IndexTable.Row
      id={mapping.id}
      key={mapping.id}
      selected={selectedResources.includes(mapping.id)}
      position={index}
    >
      <IndexTable.Cell>
        <Text fontWeight="bold" as="span">
          {mapping.variantId}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>{mapping.productId}</IndexTable.Cell>
      <IndexTable.Cell>{mapping.pack.name}</IndexTable.Cell>
      <IndexTable.Cell>
        <Badge tone={mapping.pack.tier.level >= 3 ? "magic" : "info"}>
          {mapping.pack.tier.name}
        </Badge>
      </IndexTable.Cell>
      <IndexTable.Cell>
        {new Date(mapping.createdAt).toLocaleDateString()}
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Button
          size="micro"
          variant="primary"
          tone="critical"
          onClick={() => handleDelete(mapping.id)}
        >
          Remove
        </Button>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  return (
    <Page
      title="Variant → Pack Mapping"
      backAction={{ content: "Home", url: "/app" }}
      primaryAction={{ content: "Add Mapping", onAction: toggleModal }}
    >
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
          <Card padding="500">
            <BlockStack gap="300">
              <Text variant="headingLg" as="h2">What are Order Rules?</Text>
              <Text as="p">
                This is the bridge between physical purchases and digital access! It links Shopify product variants directly to Digital Packs.
              </Text>
              <Text as="p" fontWeight="bold">How to use it:</Text>
              <Text as="p" tone="subdued">
                Enter a Shopify Product Variant ID and choose which Pack it automatically unlocks when a customer buys it.
              </Text>
              <Text as="p" fontWeight="bold">Example:</Text>
              <Text as="p" tone="subdued">
                When someone buys the "Snarky Cat Tower (Color: Black)" variant, the system automatically detects the purchase and grants them permanent access to the selected "Ultimate Pack".
              </Text>
            </BlockStack>
          </Card>
            <Card padding="0">
              <IndexTable
                resourceName={resourceName}
                itemCount={mappings.length}
                selectedItemsCount={
                  allResourcesSelected ? "All" : selectedResources.length
                }
                onSelectionChange={handleSelectionChange}
                headings={[
                  { title: "Variant ID" },
                  { title: "Product ID" },
                  { title: "Pack" },
                  { title: "Tier" },
                  { title: "Created" },
                  { title: "Actions" },
                ]}
              >
                {rowMarkup}
              </IndexTable>
            </Card>
          </BlockStack>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">
                Finding Variant IDs
              </Text>
              <Text as="p" variant="bodyMd">
                Go to <strong>Products</strong> in your Shopify admin, click a
                product, and look at the URL of a specific variant. The numeric
                ID at the end is the Variant ID.
              </Text>
              <Text as="p" variant="bodyMd">
                Alternatively, use the GraphQL explorer to query your product
                variants programmatically.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>

      <Modal
        open={modalOpen}
        onClose={toggleModal}
        title="Map a Variant to a Pack"
        primaryAction={{
          content: "Save Mapping",
          onAction: handleCreate,
          loading: isSaving,
        }}
        secondaryActions={[{ content: "Cancel", onAction: toggleModal }]}
      >
        <Modal.Section>
          <FormLayout>
            <TextField
              label="Shopify Variant ID"
              value={variantId}
              onChange={setVariantId}
              autoComplete="off"
              helpText="The numeric variant ID from your Shopify product."
            />
            <TextField
              label="Shopify Product ID (optional)"
              value={productId}
              onChange={setProductId}
              autoComplete="off"
              helpText="Optional — helps with auditing which product this belongs to."
            />
            <Select
              label="Target Pack"
              options={packs.map((p) => ({
                label: `${p.name} (${p.tier.name})`,
                value: p.id,
              }))}
              value={selectedPack}
              onChange={setSelectedPack}
              helpText="The digital pack the customer receives after purchasing this variant."
            />
          </FormLayout>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
