package api

import (
	"encoding/base64"
	"fmt"
	"io/ioutil"

	"github.com/oscartbeaumont/forge/dominion/internal"
	"github.com/oscartbeaumont/forge/dominion/pkg/syncml"
)

type ManageContext struct {
	UDID          string
	DeviceID      string
	IsManagedUser bool
	UPN           string
	AADUserOID    string
	AADDeviceID   string
}

type NodeLoc struct {
	MsgID string
	CmdID string
}

type Node struct {
	Cmd        string
	Status     string
	MSFTStatus string
	Data       map[string]NodeData
	Nodes      map[string]Node
}

type NodeData struct {
	Status     string
	MSFTStatus string
	Format     string
	Type       string
	Data       string
}

var done = false

// Manage handles data returned from the device, sending policies to the device and checking status of policies pushed to the device
func (api *Service) Manage(context ManageContext, resCmdID syncml.CommandID, tree map[NodeLoc]Node) (map[string]Node, error) {
	// Be aware if the MDM is AzureAD Joined (Device level) context.UPN could be a user other than the person who enrolled in MDM.
	// The idea is this entire handler would be implemented on the Mattrax API and use a JSON Post request to communicate with this Microservice

	// Be aware for MSI installation (or any other asynchronous task) a status will be returned straight away to say the command was accepted and another one
	// will be returned upon completion of the action.

	fmt.Println(context, tree)

	// TODO: Show User/Device Information from Context

	for nodeLoc, node := range tree {
		if node.Status != "0" {
			fmt.Println(fmt.Sprintf("'%v' reported status %v for command '%v' of type '%v'", context.DeviceID, node.Status, nodeLoc.MsgID+"-"+nodeLoc.CmdID, node.Cmd))
		}

		for omaURI, dataNode := range node.Data {
			fmt.Println(fmt.Sprintf("'%v' reported node with status %v | %v:'%v'", context.DeviceID, internal.Ternary(dataNode.Status == "", node.Status, dataNode.Status)+internal.Ternary(dataNode.MSFTStatus != "", "(original error: "+dataNode.MSFTStatus+")", ""), omaURI, dataNode.Data))
		}
	}

	// TEMP: Loop prevention
	if done == true {
		return map[string]Node{}, nil
	}
	done = true

	// var testMSIGUID = "{FED2633D-E988-4D82-ADC6-5A11686AA138}" // This has to be found from the MSI
	// // This demonstrates how policies can be device or user scoped. Before deploying a user scoped policies you must verify context.ManagedUser == "true".
	// // A production system would either just install the app to the device scope or wait until context.ManagedUser == "true" for user scoped polciies instead of falling back to the device scope.
	// var testMsiNode = Ternary(context.ManagedUser == true, "./User/Vendor", "./Vendor") + "/MSFT/EnterpriseDesktopAppManagement/MSI/" + url.QueryEscape(testMSIGUID) + "/DownloadInstall"
	// var testMSIURL = "https://clever-bhabha-2d2d85.netlify.app/example.msi"
	// var testMSIHash = "4234B4FAEE2F519CC7CA7D592BC0626FCFECAB33D4EDED4D920D2A1C2C25FEFA" // This is a SHA256 hash of the file

	// Generate PKX
	// openssl genrsa -out clientCert.key 1024
	// openssl req -new -sha256 -key clientCert.key -subj "/CN=Testing/OU=Stately" -out clientCert.csr
	// openssl x509 -req -in clientCert.csr -CAform der -CA ./certs/identity.crt -CAkeyform der -CAkey ./certs/identity.key -CAcreateserial -out clientCert.crt -days 365 -sha256
	// openssl pkcs12 -export -in clientCert.crt -inkey clientCert.key -out clientCert.pfx
	// openssl x509 -noout -fingerprint -sha1 -inform pem -in clientCert.crt

	pfxRaw, err := ioutil.ReadFile("./clientCert.pfx")
	if err != nil {
		panic(err)
	}

	var pfxThumbprint = "6E7F156C390BB6B5DD7090E3BFA7666E20210047"
	var pfxURI = "./Vendor/MSFT/ClientCertificateInstall/PFXCertInstall/" + pfxThumbprint

	return map[string]Node{
		resCmdID.Next(): {
			Cmd: "Delete",
			Data: map[string]NodeData{
				pfxURI: {},
			},
		},
		// TODO: Use Atomic
		resCmdID.Next(): {
			Cmd: "Add",
			Data: map[string]NodeData{
				pfxURI: {
					Format: "node",
				},
				pfxURI + "/KeyLocation": {
					Format: "int",
					Data:   "2",
				},
				pfxURI + "/PFXCertPasswordEncryptionType": {
					Format: "int",
					Data:   "0", // TODO: This can be more secure
				},
				pfxURI + "/Thumbprint": {
					Format: "chr",
					Data:   pfxThumbprint,
				},
				pfxURI + "/PFXCertPassword": {
					Format: "chr",
					Data:   base64.StdEncoding.EncodeToString([]byte("password")), // TODO: Encrypted?
				},
				pfxURI + "/PFXCertBlob": {
					Format: "chr",
					Data:   base64.StdEncoding.EncodeToString(pfxRaw),
				},
			},
		},

		// resCmdID.Next(): {
		// 	Cmd: "Get",
		// 	Data: map[string]NodeData{
		// 		"./DevDetail/SwV": {},
		// 		"./DevDetail/OEM": {},
		// 		"./Vendor/MSFT/Policy/Config/Camera/AllowCamera": {},
		// 		"./NotFound/Me": {},
		// 	},
		// },
		// resCmdID.Next(): {
		// 	Cmd: "Replace",
		// 	Data: map[string]NodeData{
		// 		"./Vendor/MSFT/Policy/Config/Camera/AllowCamera": {
		// 			Format: "int",
		// 			Data:   "0",
		// 		},
		// 		"./Vendor/MSFT/Policy/Config/Connectivity/AllowBluetooth": {
		// 			Format: "int",
		// 			Data:   "0",
		// 		},
		// 		"./Vendor/MSFT/DeviceManageability/Provider/" + internal.ProviderID + "/ConfigInfo": {
		// 			Format: "chr",
		// 			Data:   "auth_token_goes_here",
		// 		},
		// 	},
		// },
		// resCmdID.Next(): {
		// 	Cmd: "Atomic",
		// 	Nodes: map[string]Node{
		// 		resCmdID.Next(): {
		// 			Cmd: "Add",
		// 			Data: map[string]NodeData{
		// 				testMsiNode: {
		// 					Format: "int",
		// 					Data:   "0",
		// 				},
		// 			},
		// 		},
		// 		resCmdID.Next(): {
		// 			Cmd: "Exec",
		// 			Data: map[string]NodeData{
		// 				testMsiNode: {
		// 					Format: "xml",
		// 					Type:   "text/plain",
		// 					Data: `<MsiInstallJob id="` + testMSIGUID + `">
		// 					<Product Version="1.0.0">
		// 					  <Download>
		// 						<ContentURLList>
		// 						  <ContentURL>` + testMSIURL + `</ContentURL>
		// 						</ContentURLList>
		// 					  </Download>
		// 					  <Validation>
		// 						<FileHash>` + testMSIHash + `</FileHash>
		// 					  </Validation>
		// 					  <Enforcement>
		// 						<CommandLine>/quiet</CommandLine>
		// 						<TimeOut>5</TimeOut>
		// 						<RetryCount>3</RetryCount>
		// 						<RetryInterval>5</RetryInterval>
		// 					  </Enforcement>
		// 					</Product>
		// 				  </MsiInstallJob>`,
		// 				},
		// 			},
		// 		},
		// 	},
		// },
	}, nil
}
