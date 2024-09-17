import {
	Badge,
	BreadcrumbItem,
	Button,
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@mattrax/ui";
import { Page } from "~/components/Page";

export default function () {
	// TODO: Replace tabs with a proper filter system

	return (
		<Page
			title="Devices"
			breadcrumbs={[
				<BreadcrumbItem>
					<BreadcrumbItem>Devices</BreadcrumbItem>
				</BreadcrumbItem>,
			]}
		>
			<div class="px-4 sm:px-6 lg:px-8">
				{/* <div class="sm:flex sm:items-center">
					<div class="sm:flex-auto">
						<h1 class="text-base font-semibold leading-6 text-gray-900">
							Users
						</h1>
						<p class="mt-2 text-sm text-gray-700">
							A list of all the users in your account including their name,
							title, email and role.
						</p>
					</div>
					<div class="mt-4 sm:ml-16 sm:mt-0 sm:flex-none">
						<button
							type="button"
							class="block rounded-md bg-indigo-600 px-3 py-2 text-center text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
						>
							Add user
						</button>
					</div>
				</div> */}
				<div class="mt-8 flow-root">
					<div class="-mx-4 -my-2 overflow-x-auto sm:-mx-6 lg:-mx-8">
						<div class="inline-block min-w-full py-2 align-middle sm:px-6 lg:px-8">
							<table class="min-w-full divide-y divide-gray-300">
								<thead>
									<tr>
										<th
											scope="col"
											class="py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-gray-900 sm:pl-0"
										>
											<a href="#" class="group inline-flex">
												Name
												{/* <!-- Active: "bg-gray-200 text-gray-900 group-hover:bg-gray-300", Not Active: "invisible text-gray-400 group-hover:visible group-focus:visible" --> */}
												<span class="invisible ml-2 flex-none rounded text-gray-400 group-hover:visible group-focus:visible">
													<svg
														class="h-5 w-5"
														viewBox="0 0 20 20"
														fill="currentColor"
														aria-hidden="true"
													>
														<path
															fill-rule="evenodd"
															d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
															clip-rule="evenodd"
														/>
													</svg>
												</span>
											</a>
										</th>
										<th
											scope="col"
											class="px-3 py-3.5 text-left text-sm font-semibold text-gray-900"
										>
											<a href="#" class="group inline-flex">
												Title
												{/* <!-- Active: "bg-gray-200 text-gray-900 group-hover:bg-gray-300", Not Active: "invisible text-gray-400 group-hover:visible group-focus:visible" --> */}
												<span class="ml-2 flex-none rounded bg-gray-100 text-gray-900 group-hover:bg-gray-200">
													<svg
														class="h-5 w-5"
														viewBox="0 0 20 20"
														fill="currentColor"
														aria-hidden="true"
													>
														<path
															fill-rule="evenodd"
															d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
															clip-rule="evenodd"
														/>
													</svg>
												</span>
											</a>
										</th>
										<th
											scope="col"
											class="px-3 py-3.5 text-left text-sm font-semibold text-gray-900"
										>
											<a href="#" class="group inline-flex">
												Email
												{/* <!-- Active: "bg-gray-200 text-gray-900 group-hover:bg-gray-300", Not Active: "invisible text-gray-400 group-hover:visible group-focus:visible" --> */}
												<span class="invisible ml-2 flex-none rounded text-gray-400 group-hover:visible group-focus:visible">
													<svg
														class="invisible ml-2 h-5 w-5 flex-none rounded text-gray-400 group-hover:visible group-focus:visible"
														viewBox="0 0 20 20"
														fill="currentColor"
														aria-hidden="true"
													>
														<path
															fill-rule="evenodd"
															d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
															clip-rule="evenodd"
														/>
													</svg>
												</span>
											</a>
										</th>
										<th
											scope="col"
											class="px-3 py-3.5 text-left text-sm font-semibold text-gray-900"
										>
											<a href="#" class="group inline-flex">
												Role
												{/* <!-- Active: "bg-gray-200 text-gray-900 group-hover:bg-gray-300", Not Active: "invisible text-gray-400 group-hover:visible group-focus:visible" --> */}
												<span class="invisible ml-2 flex-none rounded text-gray-400 group-hover:visible group-focus:visible">
													<svg
														class="invisible ml-2 h-5 w-5 flex-none rounded text-gray-400 group-hover:visible group-focus:visible"
														viewBox="0 0 20 20"
														fill="currentColor"
														aria-hidden="true"
													>
														<path
															fill-rule="evenodd"
															d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
															clip-rule="evenodd"
														/>
													</svg>
												</span>
											</a>
										</th>
										<th scope="col" class="relative py-3.5 pl-3 pr-0">
											<span class="sr-only">Edit</span>
										</th>
									</tr>
								</thead>
								<tbody class="divide-y divide-gray-200 bg-white">
									<tr>
										<td class="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-gray-900 sm:pl-0">
											Lindsay Walton
										</td>
										<td class="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
											Front-end Developer
										</td>
										<td class="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
											lindsay.walton@example.com
										</td>
										<td class="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
											Member
										</td>
										<td class="relative whitespace-nowrap py-4 pl-3 pr-4 text-right text-sm sm:pr-0">
											<a href="#" class="text-indigo-600 hover:text-indigo-900">
												Edit<span class="sr-only">, Lindsay Walton</span>
											</a>
										</td>
									</tr>
								</tbody>
							</table>
						</div>
					</div>
				</div>
			</div>

			{/* // TODO: Multiple `main` elements on the page isn't great */}
			<main class="grid flex-1 items-start gap-4 py-4 md:gap-8">
				<Tabs defaultValue="all">
					<div class="flex items-center">
						<TabsList>
							<TabsTrigger value="all">All</TabsTrigger>
							<TabsTrigger value="active">Active</TabsTrigger>
							<TabsTrigger value="draft">Draft</TabsTrigger>
							<TabsTrigger value="archived" class="hidden sm:flex">
								Archived
							</TabsTrigger>
						</TabsList>
						<div class="ml-auto flex items-center gap-2">
							<DropdownMenu>
								<DropdownMenuTrigger
									as={Button}
									variant="outline"
									size="sm"
									class="h-7 gap-1"
								>
									{/* <ListFilter class="h-3.5 w-3.5" /> */}
									<span class="sr-only sm:not-sr-only sm:whitespace-nowrap">
										Filter
									</span>
								</DropdownMenuTrigger>
								<DropdownMenuContent align="end">
									<DropdownMenuLabel>Filter by</DropdownMenuLabel>
									<DropdownMenuSeparator />
									<DropdownMenuCheckboxItem checked>
										Active
									</DropdownMenuCheckboxItem>
									<DropdownMenuCheckboxItem>Draft</DropdownMenuCheckboxItem>
									<DropdownMenuCheckboxItem>Archived</DropdownMenuCheckboxItem>
								</DropdownMenuContent>
							</DropdownMenu>
							<Button size="sm" variant="outline" class="h-7 gap-1">
								{/* <File class="h-3.5 w-3.5" /> */}
								<span class="sr-only sm:not-sr-only sm:whitespace-nowrap">
									Export
								</span>
							</Button>
							<Button size="sm" class="h-7 gap-1">
								{/* <PlusCircle class="h-3.5 w-3.5" /> */}
								<span class="sr-only sm:not-sr-only sm:whitespace-nowrap">
									Add Product
								</span>
							</Button>
						</div>
					</div>
					<TabsContent value="all">
						<Card x-chunk="A list of products in a table with actions. Each row has an image, name, status, price, total sales, created at and">
							<CardHeader>
								<CardTitle>Products</CardTitle>
								<CardDescription>
									Manage your products and view their sales performance.
								</CardDescription>
							</CardHeader>
							<CardContent>
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead class="hidden w-[100px] sm:table-cell">
												<span class="sr-only">Image</span>
											</TableHead>
											<TableHead>Name</TableHead>
											<TableHead>Status</TableHead>
											<TableHead>Price</TableHead>
											<TableHead class="hidden md:table-cell">
												Total Sales
											</TableHead>
											<TableHead class="hidden md:table-cell">
												Created at
											</TableHead>
											<TableHead>
												<span class="sr-only">Actions</span>
											</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										<TableRow>
											<TableCell class="hidden sm:table-cell">
												{/* <Image
													alt="Product image"
													class="aspect-square rounded-md object-cover"
													height="64"
													src="/placeholder.svg"
													width="64"
												/> */}
											</TableCell>
											<TableCell class="font-medium">
												Laser Lemonade Machine
											</TableCell>
											<TableCell>
												<Badge variant="outline">Draft</Badge>
											</TableCell>
											<TableCell>$499.99</TableCell>
											<TableCell class="hidden md:table-cell">25</TableCell>
											<TableCell class="hidden md:table-cell">
												2023-07-12 10:42 AM
											</TableCell>
											<TableCell>
												<DropdownMenu>
													<DropdownMenuTrigger asChild>
														<Button
															aria-haspopup="true"
															size="icon"
															variant="ghost"
														>
															{/* <MoreHorizontal class="h-4 w-4" /> */}
															<span class="sr-only">Toggle menu</span>
														</Button>
													</DropdownMenuTrigger>
													<DropdownMenuContent align="end">
														<DropdownMenuLabel>Actions</DropdownMenuLabel>
														<DropdownMenuItem>Edit</DropdownMenuItem>
														<DropdownMenuItem>Delete</DropdownMenuItem>
													</DropdownMenuContent>
												</DropdownMenu>
											</TableCell>
										</TableRow>
										<TableRow>
											<TableCell class="hidden sm:table-cell">
												{/* <Image
													alt="Product image"
													class="aspect-square rounded-md object-cover"
													height="64"
													src="/placeholder.svg"
													width="64"
												/> */}
											</TableCell>
											<TableCell class="font-medium">
												Hypernova Headphones
											</TableCell>
											<TableCell>
												<Badge variant="outline">Active</Badge>
											</TableCell>
											<TableCell>$129.99</TableCell>
											<TableCell class="hidden md:table-cell">100</TableCell>
											<TableCell class="hidden md:table-cell">
												2023-10-18 03:21 PM
											</TableCell>
											<TableCell>
												<DropdownMenu>
													<DropdownMenuTrigger asChild>
														<Button
															aria-haspopup="true"
															size="icon"
															variant="ghost"
														>
															{/* <MoreHorizontal class="h-4 w-4" /> */}
															<span class="sr-only">Toggle menu</span>
														</Button>
													</DropdownMenuTrigger>
													<DropdownMenuContent align="end">
														<DropdownMenuLabel>Actions</DropdownMenuLabel>
														<DropdownMenuItem>Edit</DropdownMenuItem>
														<DropdownMenuItem>Delete</DropdownMenuItem>
													</DropdownMenuContent>
												</DropdownMenu>
											</TableCell>
										</TableRow>
										<TableRow>
											<TableCell class="hidden sm:table-cell">
												{/* <Image
													alt="Product image"
													class="aspect-square rounded-md object-cover"
													height="64"
													src="/placeholder.svg"
													width="64"
												/> */}
											</TableCell>
											<TableCell class="font-medium">
												AeroGlow Desk Lamp
											</TableCell>
											<TableCell>
												<Badge variant="outline">Active</Badge>
											</TableCell>
											<TableCell>$39.99</TableCell>
											<TableCell class="hidden md:table-cell">50</TableCell>
											<TableCell class="hidden md:table-cell">
												2023-11-29 08:15 AM
											</TableCell>
											<TableCell>
												<DropdownMenu>
													<DropdownMenuTrigger asChild>
														<Button
															aria-haspopup="true"
															size="icon"
															variant="ghost"
														>
															{/* <MoreHorizontal class="h-4 w-4" /> */}
															<span class="sr-only">Toggle menu</span>
														</Button>
													</DropdownMenuTrigger>
													<DropdownMenuContent align="end">
														<DropdownMenuLabel>Actions</DropdownMenuLabel>
														<DropdownMenuItem>Edit</DropdownMenuItem>
														<DropdownMenuItem>Delete</DropdownMenuItem>
													</DropdownMenuContent>
												</DropdownMenu>
											</TableCell>
										</TableRow>
										<TableRow>
											<TableCell class="hidden sm:table-cell">
												{/* <Image
													alt="Product image"
													class="aspect-square rounded-md object-cover"
													height="64"
													src="/placeholder.svg"
													width="64"
												/> */}
											</TableCell>
											<TableCell class="font-medium">
												TechTonic Energy Drink
											</TableCell>
											<TableCell>
												<Badge variant="secondary">Draft</Badge>
											</TableCell>
											<TableCell>$2.99</TableCell>
											<TableCell class="hidden md:table-cell">0</TableCell>
											<TableCell class="hidden md:table-cell">
												2023-12-25 11:59 PM
											</TableCell>
											<TableCell>
												<DropdownMenu>
													<DropdownMenuTrigger asChild>
														<Button
															aria-haspopup="true"
															size="icon"
															variant="ghost"
														>
															{/* <MoreHorizontal class="h-4 w-4" /> */}
															<span class="sr-only">Toggle menu</span>
														</Button>
													</DropdownMenuTrigger>
													<DropdownMenuContent align="end">
														<DropdownMenuLabel>Actions</DropdownMenuLabel>
														<DropdownMenuItem>Edit</DropdownMenuItem>
														<DropdownMenuItem>Delete</DropdownMenuItem>
													</DropdownMenuContent>
												</DropdownMenu>
											</TableCell>
										</TableRow>
										<TableRow>
											<TableCell class="hidden sm:table-cell">
												{/* <Image
													alt="Product image"
													class="aspect-square rounded-md object-cover"
													height="64"
													src="/placeholder.svg"
													width="64"
												/> */}
											</TableCell>
											<TableCell class="font-medium">
												Gamer Gear Pro Controller
											</TableCell>
											<TableCell>
												<Badge variant="outline">Active</Badge>
											</TableCell>
											<TableCell>$59.99</TableCell>
											<TableCell class="hidden md:table-cell">75</TableCell>
											<TableCell class="hidden md:table-cell">
												2024-01-01 12:00 AM
											</TableCell>
											<TableCell>
												<DropdownMenu>
													<DropdownMenuTrigger asChild>
														<Button
															aria-haspopup="true"
															size="icon"
															variant="ghost"
														>
															{/* <MoreHorizontal class="h-4 w-4" /> */}
															<span class="sr-only">Toggle menu</span>
														</Button>
													</DropdownMenuTrigger>
													<DropdownMenuContent align="end">
														<DropdownMenuLabel>Actions</DropdownMenuLabel>
														<DropdownMenuItem>Edit</DropdownMenuItem>
														<DropdownMenuItem>Delete</DropdownMenuItem>
													</DropdownMenuContent>
												</DropdownMenu>
											</TableCell>
										</TableRow>
										<TableRow>
											<TableCell class="hidden sm:table-cell">
												{/* <Image
													alt="Product image"
													class="aspect-square rounded-md object-cover"
													height="64"
													src="/placeholder.svg"
													width="64"
												/> */}
											</TableCell>
											<TableCell class="font-medium">
												Luminous VR Headset
											</TableCell>
											<TableCell>
												<Badge variant="outline">Active</Badge>
											</TableCell>
											<TableCell>$199.99</TableCell>
											<TableCell class="hidden md:table-cell">30</TableCell>
											<TableCell class="hidden md:table-cell">
												2024-02-14 02:14 PM
											</TableCell>
											<TableCell>
												<DropdownMenu>
													<DropdownMenuTrigger asChild>
														<Button
															aria-haspopup="true"
															size="icon"
															variant="ghost"
														>
															{/* <MoreHorizontal class="h-4 w-4" /> */}
															<span class="sr-only">Toggle menu</span>
														</Button>
													</DropdownMenuTrigger>
													<DropdownMenuContent align="end">
														<DropdownMenuLabel>Actions</DropdownMenuLabel>
														<DropdownMenuItem>Edit</DropdownMenuItem>
														<DropdownMenuItem>Delete</DropdownMenuItem>
													</DropdownMenuContent>
												</DropdownMenu>
											</TableCell>
										</TableRow>
									</TableBody>
								</Table>
							</CardContent>
							<CardFooter>
								<div class="text-xs text-zinc-500 dark:text-zinc-400">
									Showing <strong>1-10</strong> of <strong>32</strong>
									{""}
									products
								</div>
							</CardFooter>
						</Card>
					</TabsContent>
				</Tabs>
			</main>
		</Page>
	);
}
