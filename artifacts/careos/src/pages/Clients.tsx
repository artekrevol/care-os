import { Layout } from "@/components/layout/Layout";
import { useListClients } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Plus } from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";
import { format } from "date-fns";

export default function Clients() {
  const [search, setSearch] = useState("");
  const { data: clients, isLoading } = useListClients({ search: search || undefined });

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">Clients</h1>
            <p className="text-muted-foreground mt-1">Manage care recipients and their authorizations.</p>
          </div>
          <Button asChild>
            <Link href="/clients/new">
              <Plus className="mr-2 h-4 w-4" /> New Client
            </Link>
          </Button>
        </div>

        <Card>
          <div className="p-4 border-b">
            <div className="relative w-full max-w-sm">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Search clients..."
                className="pl-8"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Payer</TableHead>
                  <TableHead>Intake Date</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Loading clients...</TableCell>
                  </TableRow>
                ) : clients?.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No clients found.</TableCell>
                  </TableRow>
                ) : (
                  clients?.map((client) => (
                    <TableRow key={client.id}>
                      <TableCell className="font-medium">
                        {client.firstName} {client.lastName}
                      </TableCell>
                      <TableCell>
                        <Badge variant={client.status === 'ACTIVE' ? 'default' : 'secondary'}>
                          {client.status.replace('_', ' ')}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{client.primaryPayer.replace('_', ' ')}</Badge>
                      </TableCell>
                      <TableCell>
                        {client.intakeDate ? format(new Date(client.intakeDate), "MMM d, yyyy") : "-"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" asChild>
                          <Link href={`/clients/${client.id}`}>View</Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}