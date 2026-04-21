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
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { uploadAsset } from "../services/storage.server";
import prisma from "../db.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);

  const assets = await prisma.digitalAsset.findMany({
    where: { isActive: true },
    include: { _count: { select: { packAssets: true, dropAssets: true } } },
    orderBy: { createdAt: "desc" },
  });

  const packs = await prisma.pack.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
  });

  return { assets, packs };
}

export async function action({ request }: ActionFunctionArgs) {
  await authenticate.admin(request);

  // Parse multi-part form data natively
  const formData = await request.formData();
  
  const intent = formData.get("intent");

  if (intent === "upload") {
    const title = formData.get("title") as string;
    const type = formData.get("type") as string;
    const packId = formData.get("packId") as string | null;
    const file = formData.get("file") as File;

    if (!file || file.size === 0) return { error: "File required" };

    try {
      const fileKey = `${Date.now()}-${file.name.replace(/\s+/g, "_")}`;
      
      // Upload directly to Cloudflare R2
      await uploadAsset(file, fileKey);

      // Create Database Record
      const asset = await prisma.digitalAsset.create({
        data: {
          title,
          type,
          fileKey,
        },
      });

      // Join to pack if specified
      if (packId) {
        await prisma.packAsset.create({
          data: {
            packId,
            assetId: asset.id,
          },
        });
      }

      return { success: true };
    } catch (err: any) {
      console.error("[Asset Upload Error]", err);
      return { error: err.message };
    }
  }

  if (intent === "delete") {
    const assetId = formData.get("assetId") as string;
    await prisma.digitalAsset.update({
      where: { id: assetId },
      data: { isActive: false },
    });
    return { success: true };
  }

  return { error: "Invalid intent" };
}

export default function DigitalAssetsPage() {
  const { assets, packs } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const nav = useNavigation();
  const isSaving = nav.state === "submitting" && nav.formData?.get("intent") === "upload";

  const [modalOpen, setModalOpen] = useState(false);
  const toggleModal = useCallback(() => setModalOpen((active) => !active), []);

  const [title, setTitle] = useState("");
  const [type, setType] = useState("JPG");
  const [selectedPack, setSelectedPack] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const handleUpload = useCallback(() => {
    if (!file) return;

    const formData = new FormData();
    formData.append("intent", "upload");
    formData.append("title", title);
    formData.append("type", type);
    if (selectedPack) formData.append("packId", selectedPack);
    formData.append("file", file);

    submit(formData, { method: "post", encType: "multipart/form-data" });
    setModalOpen(false);
    setTitle("");
    setFile(null);
  }, [file, title, type, selectedPack, submit]);

  const handleDelete = useCallback(
    (id: string) => submit({ intent: "delete", assetId: id }, { method: "post" }),
    [submit]
  );

  const resourceName = { singular: "asset", plural: "assets" };
  const { selectedResources, allResourcesSelected, handleSelectionChange } =
    useIndexResourceState(assets);

  const rowMarkup = assets.map((asset, index) => (
    <IndexTable.Row
      id={asset.id}
      key={asset.id}
      selected={selectedResources.includes(asset.id)}
      position={index}
    >
      <IndexTable.Cell>
        <Text fontWeight="bold" as="span">{asset.title}</Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Badge tone="magic">{asset.type}</Badge>
      </IndexTable.Cell>
      <IndexTable.Cell>{asset.fileKey}</IndexTable.Cell>
      <IndexTable.Cell>{asset._count.packAssets} Packs</IndexTable.Cell>
      <IndexTable.Cell>{new Date(asset.createdAt).toLocaleDateString()}</IndexTable.Cell>
      <IndexTable.Cell>
        <Button size="micro" tone="critical" onClick={() => handleDelete(asset.id)}>
          Remove
        </Button>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  return (
    <Page
      title="Digital Assets Library"
      backAction={{ content: "Home", url: "/app" }}
      primaryAction={{ content: "Upload File", onAction: toggleModal }}
    >
      <Layout>
        <Layout.Section>
          <Card padding="0">
            <IndexTable
              resourceName={resourceName}
              itemCount={assets.length}
              selectedItemsCount={
                allResourcesSelected ? "All" : selectedResources.length
              }
              onSelectionChange={handleSelectionChange}
              headings={[
                { title: "Title" },
                { title: "Type" },
                { title: "Object Key" },
                { title: "Associations" },
                { title: "Uploaded" },
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
        title="Upload to Supabase Storage"
        primaryAction={{
          content: "Upload",
          onAction: handleUpload,
          loading: isSaving,
          disabled: !file || !title,
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
              label="Asset Title"
              value={title}
              onChange={setTitle}
              autoComplete="off"
            />
            <Select
              label="File Type"
              options={["JPG", "PNG", "GIF", "MP4", "PDF"]}
              value={type}
              onChange={setType}
            />
            <Select
              label="Assign to Pack (Optional)"
              options={[{ label: "-- Auto Join None --", value: "" }, ...packs.map(p => ({ label: p.name, value: p.id }))]}
              value={selectedPack}
              onChange={setSelectedPack}
            />
            
            {/* Native file input since Polaris DropZone is heavy */}
            <div style={{ marginTop: "1rem" }}>
              <label style={{ display: "block", marginBottom: "0.5rem" }}>File Upload</label>
              <input
                type="file"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                style={{ width: "100%", padding: "0.5rem" }}
              />
            </div>

          </FormLayout>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
