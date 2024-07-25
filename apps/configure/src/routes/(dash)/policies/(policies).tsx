import { PageLayout, PageLayoutHeading } from "~/components/PageLayout";
import { SearchPage, createSearchPageContext } from "~/components/search";
import { useSyncEngine } from "~/lib/sync";

export default function Page() {
	const sync = useSyncEngine();
	const ctx = createSearchPageContext([
		{
			type: "enum",
			target: "type",
			value: "policies",
		},
	]);

	return (
		<PageLayout heading={<PageLayoutHeading>Policies</PageLayoutHeading>}>
			<SearchPage {...ctx} showFilterBar={false} />

			<button
				type="button"
				onClick={async () => {
					const token = await sync.getAccessToken();

					const resp = await fetch(
						"https://graph.microsoft.com/beta/deviceManagement/configurationPolicies",
						{
							method: "POST",
							headers: {
								Authorization: token,
								"Content-Type": "application/json",
							},
							body: JSON.stringify({
								name: "Created via API",
								platforms: "windows10",
								technologies: "mdm",
								settings: [
									{
										"@odata.type":
											"#microsoft.graph.deviceManagementConfigurationSetting",
										settingInstance: {
											"@odata.type":
												"#microsoft.graph.deviceManagementConfigurationChoiceSettingInstance",
											settingDefinitionId:
												"device_vendor_msft_policy_config_accounts_allowaddingnonmicrosoftaccountsmanually",
											choiceSettingValue: {
												"@odata.type":
													"#microsoft.graph.deviceManagementConfigurationChoiceSettingValue",
												value:
													"device_vendor_msft_policy_config_accounts_allowaddingnonmicrosoftaccountsmanually_1",
												children: [],
											},
										},
									},
								],
							}),
						},
					);

					console.log(await resp.text());
				}}
			>
				Debug
			</button>
		</PageLayout>
	);
}
