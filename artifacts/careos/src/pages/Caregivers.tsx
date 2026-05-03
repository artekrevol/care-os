import { Layout } from "@/components/layout/Layout";
import { useListCaregivers } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, UserPlus } from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";

export default function Caregivers() {
  const [search, setSearch] = useState("");
  const { data: caregivers, isLoading } = useListCaregivers({ search: search || undefined });

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">Caregivers</h1>
            <p className="text-muted-foreground mt-1">Manage workforce and compliance documents.</p>
          </div>
          <Button asChild>
            <Link href="/caregivers/new">
              <UserPlus className="mr-2 h-4 w-4" /> New Caregiver
            </Link>
          </Button>
        </div>

        <Card>
          <div className="p-4 border-b">
            <div className="relative w-full max-w-sm">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Search caregivers..."
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
                  <TableHead>Type</TableHead>
                  <TableHead>Docs (Valid/Expiring/Expired)</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Loading caregivers...</TableCell>
                  </TableRow>
                ) : caregivers?.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No caregivers found.</TableCell>
                  </TableRow>
                ) : (
                  caregivers?.map((cg) => (
                    <TableRow key={cg.id}>
                      <TableCell className="font-medium">
                        {cg.firstName} {cg.lastName}
                      </TableCell>
                      <TableCell>
                        <Badge variant={cg.status === 'ACTIVE' ? 'default' : 'secondary'}>
                          {cg.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{cg.employmentType}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="text-green-600 font-medium">{cg.documentsValid}</span> / 
                          <span className="text-amber-500 font-medium">{cg.documentsExpiring}</span> / 
                          <span className="text-red-600 font-medium">{cg.documentsExpired}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-medium text-muted-foreground">
                        ${cg.payRate.toFixed(2)}/h
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" asChild>
                          <Link href={`/caregivers/${cg.id}`}>View</Link>
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